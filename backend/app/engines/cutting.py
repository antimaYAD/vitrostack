"""Deterministic 2D guillotine cutting-stock optimizer for glass.

Multi-heuristic guillotine packing (best-short-side-fit placement with
max-area split rule), run across several item orderings; the best plan is kept.
Factory offcuts are used before new jumbo sheets are opened. Glass is scored
and snapped, so every layout is guillotine-cuttable by construction.
"""
from __future__ import annotations

from dataclasses import dataclass, field

JUMBO_W, JUMBO_H = 3660, 2440
EDGE_TRIM_MM = 10
KERF_MM = 2
MIN_REMNANT_SIDE_MM = 300
MIN_REMNANT_AREA_M2 = 0.25


@dataclass
class Rect:
    x: int
    y: int
    w: int
    h: int


@dataclass
class Bin:
    source: str  # jumbo | offcut
    width: int
    height: int
    trim: int
    offcut_id: str | None = None
    free: list[Rect] = field(default_factory=list)
    placements: list[dict] = field(default_factory=list)

    def __post_init__(self):
        if not self.free:
            # Usable area enlarged by one kerf so the last piece on an edge needs none.
            self.free = [Rect(self.trim, self.trim,
                              self.width - 2 * self.trim + KERF_MM,
                              self.height - 2 * self.trim + KERF_MM)]


def _find(bin_: Bin, w: int, h: int, allow_rotate: bool):
    best = None
    for idx, r in enumerate(bin_.free):
        for rot in ((False, True) if allow_rotate and w != h else (False,)):
            iw, ih = (h, w) if rot else (w, h)
            iw_k, ih_k = iw + KERF_MM, ih + KERF_MM
            if iw_k <= r.w and ih_k <= r.h:
                short = min(r.w - iw_k, r.h - ih_k)
                long_ = max(r.w - iw_k, r.h - ih_k)
                score = (short, long_)
                if best is None or score < best[0]:
                    best = (score, idx, rot)
    return best


def _place(bin_: Bin, idx: int, rot: bool, item: dict):
    r = bin_.free.pop(idx)
    iw, ih = (item["h"], item["w"]) if rot else (item["w"], item["h"])
    iw_k, ih_k = iw + KERF_MM, ih + KERF_MM
    bin_.placements.append({"uid": item["uid"], "tag": item["tag"], "x": r.x, "y": r.y,
                            "w": iw, "h": ih, "rotated": rot})
    dw, dh = r.w - iw_k, r.h - ih_k
    # Max-area split: choose the cut that leaves the single largest rectangle.
    if dw * r.h > dh * r.w:
        right = Rect(r.x + iw_k, r.y, dw, r.h)
        top = Rect(r.x, r.y + ih_k, iw_k, dh)
    else:
        right = Rect(r.x + iw_k, r.y, dw, ih_k)
        top = Rect(r.x, r.y + ih_k, r.w, dh)
    for nr in (right, top):
        if nr.w > KERF_MM and nr.h > KERF_MM:
            bin_.free.append(nr)


def _pack(items: list[dict], offcuts: list[dict], allow_rotate: bool,
          jumbo_w: int, jumbo_h: int) -> list[Bin]:
    opened: list[Bin] = []
    spare = [Bin("offcut", o["width_mm"], o["height_mm"], 0, offcut_id=str(o["id"])) for o in offcuts]
    spare.sort(key=lambda b: b.width * b.height)  # smallest offcut first
    for item in items:
        best = None
        for b in opened:
            f = _find(b, item["w"], item["h"], allow_rotate)
            if f and (best is None or f[0] < best[0]):
                best = (f[0], b, f[1], f[2])
        if best is None:
            for i, b in enumerate(spare):
                f = _find(b, item["w"], item["h"], allow_rotate)
                if f:
                    opened.append(spare.pop(i))
                    best = (f[0], b, f[1], f[2])
                    break
        if best is None:
            b = Bin("jumbo", jumbo_w, jumbo_h, EDGE_TRIM_MM)
            f = _find(b, item["w"], item["h"], allow_rotate)
            if not f:
                raise ValueError(f"Panel {item['tag']} ({item['w']}x{item['h']} mm) exceeds jumbo sheet")
            opened.append(b)
            best = (f[0], b, f[1], f[2])
        _, b, idx, rot = best
        _place(b, idx, rot, item)
    return opened


_ORDERINGS = {
    "area": lambda it: (-(it["w"] * it["h"]), -max(it["w"], it["h"])),
    "long_side": lambda it: (-max(it["w"], it["h"]), -min(it["w"], it["h"])),
    "perimeter": lambda it: (-(it["w"] + it["h"]), -max(it["w"], it["h"])),
    "short_side": lambda it: (-min(it["w"], it["h"]), -max(it["w"], it["h"])),
    "height": lambda it: (-it["h"], -it["w"]),
    "width": lambda it: (-it["w"], -it["h"]),
}


def _summarise(bins: list[Bin]) -> dict:
    sheets, used_area, jumbo_area, offcut_area, remnant_area = [], 0, 0, 0, 0
    for i, b in enumerate(bins):
        placed = sum(p["w"] * p["h"] for p in b.placements)
        total = b.width * b.height
        remnants = []
        for r in b.free:
            w = min(r.w, b.width - b.trim - r.x)
            h = min(r.h, b.height - b.trim - r.y)
            if (w >= MIN_REMNANT_SIDE_MM and h >= MIN_REMNANT_SIDE_MM
                    and w * h / 1e6 >= MIN_REMNANT_AREA_M2):
                remnants.append({"x": r.x, "y": r.y, "w": w, "h": h})
        rem_area = sum(r["w"] * r["h"] for r in remnants)
        used_area += placed
        if b.source == "jumbo":
            jumbo_area += total
            remnant_area += rem_area
        else:
            offcut_area += total
        sheets.append({
            "index": i + 1, "source": b.source, "offcut_id": b.offcut_id,
            "width_mm": b.width, "height_mm": b.height, "trim_mm": b.trim,
            "placements": b.placements, "remnants": remnants if b.source == "jumbo" else [],
            "utilisation_pct": round(100 * placed / total, 2),
        })
    consumed = jumbo_area + offcut_area
    gross_scrap = 100 * (consumed - used_area) / consumed if consumed else 0
    net_scrap = 100 * (consumed - used_area - remnant_area) / consumed if consumed else 0
    return {
        "sheets": sheets,
        "jumbo_sheets": sum(1 for b in bins if b.source == "jumbo"),
        "offcuts_used": sum(1 for b in bins if b.source == "offcut"),
        "panel_area_m2": round(used_area / 1e6, 3),
        "consumed_area_m2": round(consumed / 1e6, 3),
        "reusable_remnant_area_m2": round(remnant_area / 1e6, 3),
        "gross_scrap_pct": round(gross_scrap, 2),
        "scrap_pct": round(max(net_scrap, 0), 2),
    }


def optimize(panels: list[dict], offcuts: list[dict] | None = None, check_offcuts: bool = True,
             allow_rotate: bool = True, jumbo_w: int = JUMBO_W, jumbo_h: int = JUMBO_H) -> dict:
    """panels: [{tag, width_mm, height_mm, quantity, glass_spec?}]; offcuts: [{id, width_mm, height_mm, glass_spec}]"""
    if not panels:
        raise ValueError("No panels supplied")
    groups: dict[str, list[dict]] = {}
    for p in panels:
        w, h, q = int(p["width_mm"]), int(p["height_mm"]), int(p.get("quantity", 1))
        if w <= 0 or h <= 0 or q <= 0:
            raise ValueError(f"Invalid panel {p}")
        spec = p.get("glass_spec") or "unspecified"
        tag = p.get("tag") or f"{w}x{h}"
        for n in range(q):
            groups.setdefault(spec, []).append({"tag": tag, "uid": f"{tag}-{n + 1:02d}", "w": w, "h": h})

    results = []
    for spec, items in groups.items():
        spec_offcuts = [o for o in (offcuts or []) if check_offcuts and o.get("glass_spec") == spec]
        best, best_key, best_name = None, None, None
        for name, key in _ORDERINGS.items():
            bins = _pack(sorted(items, key=key), spec_offcuts, allow_rotate, jumbo_w, jumbo_h)
            s = _summarise(bins)
            rank = (s["jumbo_sheets"], s["scrap_pct"], -s["offcuts_used"])
            if best is None or rank < best_key:
                best, best_key, best_name = s, rank, name
        best["glass_spec"] = spec
        best["panel_count"] = len(items)
        best["heuristic"] = best_name
        results.append(best)

    totals = {
        "jumbo_sheets": sum(r["jumbo_sheets"] for r in results),
        "offcuts_used": sum(r["offcuts_used"] for r in results),
        "panel_count": sum(r["panel_count"] for r in results),
        "panel_area_m2": round(sum(r["panel_area_m2"] for r in results), 3),
        "consumed_area_m2": round(sum(r["consumed_area_m2"] for r in results), 3),
        "reusable_remnant_area_m2": round(sum(r["reusable_remnant_area_m2"] for r in results), 3),
    }
    c = totals["consumed_area_m2"]
    totals["scrap_pct"] = round(100 * (c - totals["panel_area_m2"] - totals["reusable_remnant_area_m2"]) / c, 2) if c else 0
    totals["gross_scrap_pct"] = round(100 * (c - totals["panel_area_m2"]) / c, 2) if c else 0
    totals["target_scrap_pct"] = 3.0
    return {
        "jumbo_size_mm": [jumbo_w, jumbo_h], "edge_trim_mm": EDGE_TRIM_MM, "kerf_mm": KERF_MM,
        "groups": results, "totals": totals,
    }
