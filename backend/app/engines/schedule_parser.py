"""Window schedule ingestion from CSV / Excel with fuzzy headers and unit normalisation."""
from __future__ import annotations

import csv
import io
import re

HEADER_SYNONYMS = {
    # glass_spec first so "glass type" is not captured by window_tag's "type".
    "glass_spec": ["glass", "glass spec", "glass type", "specification", "spec"],
    "window_tag": ["tag", "window id", "window", "id", "mark", "type", "ref", "code", "panel"],
    "width_mm": ["width", "w", "wd", "breadth"],
    "height_mm": ["height", "h", "ht"],
    "size": ["size", "dimension", "dimensions", "wxh", "w x h"],
    "quantity": ["qty", "quantity", "nos", "no", "count", "units", "number"],
    "floor_level": ["floor", "level", "storey", "story", "flr"],
    "glazing_notes": ["notes", "remarks", "description", "glazing", "system", "comment"],
}


def _norm(s) -> str:
    return re.sub(r"[^a-z0-9 ]", " ", str(s or "").lower()).strip()


def _map_headers(headers: list[str]) -> dict[int, tuple[str, str]]:
    """Return column index -> (field, unit_hint)."""
    mapping: dict[int, tuple[str, str]] = {}
    used = set()
    for i, h in enumerate(headers):
        n = _norm(h)
        unit = ""
        if re.search(r"\(\s*m\s*\)|\bin m\b|\bmetres?\b|\bmeters?\b", str(h).lower()):
            unit = "m"
        elif "cm" in n.split():
            unit = "cm"
        elif re.search(r"\binch|\bin\b|\"", str(h).lower()):
            unit = "in"
        words = n.replace("mm", " ").split()
        best = None
        for field, syns in HEADER_SYNONYMS.items():
            if field in used:
                continue
            for syn in syns:
                if n == syn or " ".join(words) == syn or (len(syn) > 2 and syn in n):
                    best = field
                    break
            if best:
                break
        if best:
            mapping[i] = (best, unit)
            used.add(best)
    return mapping


def _to_mm(value, unit: str) -> tuple[int | None, bool]:
    """Return (mm, ambiguous)."""
    if value is None or str(value).strip() == "":
        return None, True
    s = str(value).lower().replace(",", "").strip()
    m = re.search(r"(\d+(?:\.\d+)?)", s)
    if not m:
        return None, True
    v = float(m.group(1))
    if "mm" in s:
        unit = "mm"
    elif "cm" in s:
        unit = "cm"
    elif s.endswith("m") or unit == "m":
        unit = "m"
    elif "\"" in s or "in" in s:
        unit = "in"
    factor = {"m": 1000, "cm": 10, "in": 25.4}.get(unit, 1)
    if not unit or unit == "mm":
        # Infer: tiny numbers are metres.
        if v < 10:
            return int(round(v * 1000)), True
    mm = int(round(v * factor))
    return mm, mm < 150 or mm > 6000


def _split_size(value) -> tuple[str | None, str | None]:
    parts = re.split(r"\s*[x×X*]\s*", str(value or "").strip())
    if len(parts) == 2:
        return parts[0], parts[1]
    return None, None


def parse_rows(headers: list[str], rows: list[list]) -> dict:
    mapping = _map_headers(headers)
    fields = {f for f, _ in mapping.values()}
    if not ({"width_mm", "height_mm"} <= fields or "size" in fields):
        raise ValueError("Could not find width/height (or size) columns in the schedule header: "
                         + ", ".join(map(str, headers)))
    out = []
    for r_i, row in enumerate(rows):
        if not any(str(c).strip() for c in row if c is not None):
            continue
        rec: dict = {"window_tag": None, "width_mm": None, "height_mm": None, "quantity": 1,
                     "floor_level": None, "glazing_notes": None, "glass_spec": None,
                     "needs_review": False, "review_reasons": []}
        for i, (field, unit) in mapping.items():
            val = row[i] if i < len(row) else None
            if field in ("width_mm", "height_mm"):
                mm, amb = _to_mm(val, unit)
                rec[field] = mm
                if amb:
                    rec["needs_review"] = True
                    rec["review_reasons"].append(f"{field.split('_')[0]} '{val}' unclear")
            elif field == "size":
                w, h = _split_size(val)
                if w and h:
                    for k, v in (("width_mm", w), ("height_mm", h)):
                        mm, amb = _to_mm(v, unit)
                        rec[k] = mm
                        if amb:
                            rec["needs_review"] = True
                            rec["review_reasons"].append(f"size '{val}' unclear")
                else:
                    rec["needs_review"] = True
                    rec["review_reasons"].append(f"size '{val}' unreadable")
            elif field == "quantity":
                m = re.search(r"\d+", str(val or ""))
                rec["quantity"] = int(m.group()) if m else 1
                if not m:
                    rec["needs_review"] = True
                    rec["review_reasons"].append("quantity missing")
            else:
                rec[field] = str(val).strip() if val not in (None, "") else None
        if rec["width_mm"] is None or rec["height_mm"] is None:
            rec["needs_review"] = True
        rec["window_tag"] = rec["window_tag"] or f"W{r_i + 1}"
        out.append(rec)
    return {"rows": out, "columns_detected": {headers[i]: f for i, (f, _) in mapping.items()},
            "needs_review_count": sum(1 for r in out if r["needs_review"])}


def parse_file(filename: str, content: bytes) -> dict:
    name = filename.lower()
    if name.endswith((".xlsx", ".xlsm")):
        from openpyxl import load_workbook
        wb = load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.active
        all_rows = [list(r) for r in ws.iter_rows(values_only=True)]
    elif name.endswith((".csv", ".txt")):
        text = content.decode("utf-8-sig", errors="replace")
        sample = text[:4096]
        delim = max(",;\t", key=sample.count) if sample.strip() else ","
        all_rows = list(csv.reader(io.StringIO(text), delimiter=delim))
    else:
        raise ValueError("Unsupported file type. Upload CSV or Excel (.xlsx). PDF extraction needs the Gemini key.")
    # Header row = first row with >= 2 recognised headers (handles title rows above the table).
    for idx, row in enumerate(all_rows[:15]):
        if len(_map_headers([str(c or "") for c in row])) >= 2:
            return parse_rows([str(c or "") for c in row], all_rows[idx + 1:])
    raise ValueError("No recognisable header row found (need columns like Width, Height, Qty).")
