"""Deterministic intent & slot extraction for the offline VitroCore planner."""
from __future__ import annotations

import re

from ..engines.wind import BASIC_WIND_SPEED, FLOOR_TO_FLOOR_M

_NUM_WORDS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
              "nine": 9, "ten": 10, "twelve": 12, "twenty": 20, "fifty": 50, "hundred": 100}

DIM_RE = re.compile(r"(\d{3,4}(?:\.\d+)?)\s*(?:mm)?\s*[x×*X]\s*(\d{3,4}(?:\.\d+)?)\s*(?:mm)?")
QTY_BEFORE_RE = re.compile(
    r"(\d+)\s*(?:nos?\.?|pcs|pieces|x|×)?\s+(?:[a-z\-]+\s+){0,3}?(?:windows?|panels?|units?|lites?|pieces|pcs|nos|glass(?:es)?|panes?)"
    r"(?:\s+(?:of|at|sized?|@))?\s*$")
QTY_AFTER_RE = re.compile(r"^\s*(?:mm)?\s*(?:[-–,]?\s*(?:qty|quantity|x|×|nos?\.?)\s*[:=]?\s*)(\d+)")
QTY_AFTER_NOS_RE = re.compile(r"^\s*(?:mm)?\s*[-–,]?\s*(\d+)\s*(?:nos?\.?|pcs|pieces|units|panels|windows)\b")


def _city(text: str) -> str | None:
    t = text.lower()
    for name in sorted(BASIC_WIND_SPEED, key=len, reverse=True):
        if re.search(rf"\b{re.escape(name)}\b", t):
            return name.title()
    return None


def _height(text: str) -> tuple[float | None, str | None]:
    t = text.lower()
    m = re.search(r"\bg\s*\+\s*(\d+)", t)
    if m:
        n = int(m.group(1))
        return round((n + 1) * FLOOR_TO_FLOOR_M, 1), f"G+{n} → top floor glazing at ≈{(n + 1) * FLOOR_TO_FLOOR_M:.1f} m"
    m = re.search(r"(\d+)\s*(?:st|nd|rd|th)?[\s-]*(?:floor|storey|story|level|flr)\b", t)
    if m:
        n = int(m.group(1))
        return round((n + 1) * FLOOR_TO_FLOOR_M, 1), f"floor {n} → glazing top at ≈{(n + 1) * FLOOR_TO_FLOOR_M:.1f} m ({FLOOR_TO_FLOOR_M} m floor-to-floor)"
    m = re.search(r"(\d+)[\s-]*(?:storey|story|floors?)\s+(?:building|tower|block)", t)
    if m:
        n = int(m.group(1))
        return round(n * FLOOR_TO_FLOOR_M, 1), f"{n}-storey building → top at ≈{n * FLOOR_TO_FLOOR_M:.1f} m"
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:m|mtr|mtrs|meters?|metres?)\b(?!m)(?:\s*(?:high|tall|height|above))?", t)
    if m and float(m.group(1)) <= 500:
        # avoid picking dimensions like '2.4m wide'
        ctx = t[m.end():m.end() + 12]
        if not re.match(r"\s*(?:wide|width|x|×)", ctx):
            return float(m.group(1)), None
    m = re.search(r"height\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)", t)
    if m:
        return float(m.group(1)), None
    return None, None


def _glass(text: str) -> str | None:
    t = text.lower().replace("tempered", "toughened").replace("toughned", "toughened")
    m = re.search(r"(\d+)\s*\+\s*(\d+)\s*(?:mm)?\s*(?:lam\w*|pvb|sgp)?", t)
    if m and ("lam" in t or "pvb" in t or "sgp" in t):
        a, b = int(m.group(1)), int(m.group(2))
        return f"{a + b + 1.52:g}mm_laminated"
    m = re.search(r"(\d+(?:\.\d+)?)\s*mm\s*(toughened|laminated|lam|annealed|float|heat[\s-]?strengthened|hs)\b", t)
    if m:
        kind = m.group(2)
        kind = {"lam": "laminated", "float": "annealed", "hs": "heat_strengthened"}.get(kind, kind)
        kind = "heat_strengthened" if kind.startswith("heat") else kind
        return f"{float(m.group(1)):g}mm_{kind}"
    m = re.search(r"(\d+(?:\.\d+)?)\s*mm\s*(?:thick\s*)?glass", t)
    if m:
        return f"{float(m.group(1)):g}mm_toughened"
    return None


def _panels(text: str) -> list[dict]:
    panels = []
    for i, m in enumerate(DIM_RE.finditer(text)):
        w, h = int(float(m.group(1))), int(float(m.group(2)))
        before = text[max(0, m.start() - 70):m.start()].lower()
        after = text[m.end():m.end() + 25].lower()
        qty = None
        mb = QTY_BEFORE_RE.search(before)
        if mb:
            qty = int(mb.group(1))
        else:
            ma = QTY_AFTER_RE.match(after) or QTY_AFTER_NOS_RE.match(after)
            if ma:
                qty = int(ma.group(1))
            else:
                mw = re.search(r"\b(" + "|".join(_NUM_WORDS) + r")\s+(?:[a-z\-]+\s+){0,2}?(?:windows?|panels?)\s*(?:of)?\s*$", before)
                if mw:
                    qty = _NUM_WORDS[mw.group(1)]
        panels.append({"tag": f"W{i + 1}", "width_mm": w, "height_mm": h, "quantity": qty or 1,
                       "qty_assumed": qty is None})
    return panels


def _margin(text: str) -> float | None:
    t = text.lower()
    m = re.search(r"(\d+(?:\.\d+)?)\s*%\s*(?:margin|markup|profit)", t) or \
        re.search(r"(?:margin|markup|profit)\s*(?:of|at|=|:)?\s*(\d+(?:\.\d+)?)\s*%?", t)
    return float(m.group(1)) if m else None


def _name(text: str) -> str | None:
    m = re.search(r"(?:project|site|tower|building)\s+(?:called|named)\s+[\"“']?([\w .&-]{3,40}?)[\"”']?(?:[,.]|\s+in\s|\s+for\s|$)", text, re.I) \
        or re.search(r"[\"“]([\w .&-]{3,40})[\"”]", text)
    return m.group(1).strip() if m else None


def _client(text: str) -> str | None:
    m = re.search(r"(?:client|customer)\s*(?:is|:|-)?\s*([A-Z][\w&.]*(?:\s+[A-Z][\w&.]*){0,3})", text)
    return m.group(1).strip() if m else None


def _system(text: str) -> str | None:
    t = text.lower()
    for key, label in (("butt", "Butt-joint structural glazing"), ("unitized", "Unitized curtain wall"),
                       ("unitised", "Unitized curtain wall"), ("semi-unitized", "Semi-unitized curtain wall"),
                       ("spider", "Spider / point-fixed glazing"), ("sliding", "Sliding windows"),
                       ("casement", "Casement windows"), ("curtain wall", "Stick curtain wall"),
                       ("ssg", "Structural silicone glazing")):
        if key in t:
            return label
    return None


def intents(text: str) -> set[str]:
    t = text.lower()
    out = set()
    if re.search(r"\b(quote|quotation|estimate|price|pricing|cost|bom|bill of materials|tender)\b", t):
        out.add("quote")
    if re.search(r"\b(safe|wind|pressure|is ?875|thickness|deflection|stress|check|validate)\b", t):
        out.add("wind")
    if re.search(r"\b(silicone|bite|glueline|sealant|sausages?|dowsil|995|795)\b", t):
        out.add("silicone")
    if re.search(r"\b(cut|cutting|optimi[sz]e|wastage|scrap|nesting|nest|jumbo|layout)\b", t):
        out.add("optimize")
    if re.search(r"\b(offcuts?|inventory|stock|remnants?)\b", t):
        out.add("offcuts")
    if re.search(r"\b(projects?|pipeline|status|dashboard)\b", t) and not DIM_RE.search(text):
        out.add("projects")
    if re.search(r"\b(broken|cracked|breakage)\b", t):
        out.add("breakage")
    if re.search(r"^\s*(hi|hello|hey|help|what can you do)\b", t):
        out.add("help")
    if re.search(r"^\s*(yes|yep|ok|okay|approve|approved|go ahead|confirm|proceed|send it|do it)\b", t):
        out.add("affirm")
    if re.search(r"^\s*(no|cancel|stop|don'?t|reject)\b", t):
        out.add("deny")
    if re.search(r"\b(switch|change|use|go with|instead)\b", t) and _glass(text):
        out.add("change_spec")
    return out


def extract(text: str) -> dict:
    h, h_note = _height(text)
    return {
        "city": _city(text), "building_height_m": h, "height_note": h_note, "glass_spec": _glass(text),
        "panels": _panels(text), "margin_percent": _margin(text), "name": _name(text),
        "client": _client(text), "glazing_system": _system(text),
        "zone": "corner" if re.search(r"\bcorner|edge zone\b", text.lower()) else None,
        "terrain": _terrain(text),
    }


def _terrain(text: str) -> int | None:
    t = text.lower()
    m = re.search(r"(?:terrain\s*)?cat(?:egory)?\.?\s*([1-4])\b", t)
    if m:
        return int(m.group(1))
    if re.search(r"\b(sea[\s-]?(?:facing|front)|seafront|beach|coastline|open sea)\b", t):
        return 1
    return None
