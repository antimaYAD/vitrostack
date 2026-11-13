"""Bill of materials and client quotation costing (INR), driven by the organisation's price list."""
from __future__ import annotations

import math

from .glass import parse_glass_spec
from .rates import DEFAULT_PRICES, glass_rate
from .silicone import SEALANTS


def build_bom(panels: list[dict], cutting: dict | None, silicone: dict | None, prices: dict | None = None) -> dict:
    pr = prices or DEFAULT_PRICES
    lab, hw, lg = pr["labour"], pr["hardware"], pr["logistics"]
    lines = []
    panel_area = sum(p["width_mm"] * p["height_mm"] * p["quantity"] for p in panels) / 1e6
    perimeter = sum(2 * (p["width_mm"] + p["height_mm"]) * p["quantity"] for p in panels) / 1000
    count = sum(p["quantity"] for p in panels)

    # Glass is costed on consumed jumbo area (scrap is a real cost), net of offcut reuse.
    if cutting:
        jw, jh = cutting["jumbo_size_mm"]
        for g in cutting["groups"]:
            spec = parse_glass_spec(g["glass_spec"])
            rate = glass_rate(spec, pr)
            jumbo_area = sum(s["width_mm"] * s["height_mm"] for s in g["sheets"] if s["source"] == "jumbo") / 1e6
            lines.append({"category": "Glass", "item": f"{spec.label} – jumbo {jw}×{jh}", "qty": g["jumbo_sheets"],
                          "unit": "sheet", "rate": rate * jw * jh / 1e6, "amount": jumbo_area * rate})
            if g["offcuts_used"]:
                lines.append({"category": "Glass", "item": f"{spec.label} – reused factory offcuts",
                              "qty": g["offcuts_used"], "unit": "pc", "rate": 0, "amount": 0})
    else:
        by_spec: dict[str, float] = {}
        for p in panels:
            k = p.get("glass_spec") or "12mm_toughened"
            by_spec[k] = by_spec.get(k, 0) + p["width_mm"] * p["height_mm"] * p["quantity"] / 1e6
        for key, area in by_spec.items():
            spec = parse_glass_spec(key)
            rate = glass_rate(spec, pr)
            lines.append({"category": "Glass", "item": spec.label, "qty": round(area * 1.08, 2), "unit": "m²",
                          "rate": rate, "amount": area * 1.08 * rate})

    if silicone:
        # Quantities come from the engineering result; prices always from the current price list.
        grade = silicone.get("sealant_grade", "dowsil_995")
        for label, qty, key in ((silicone["sealant_label"], silicone["structural_sausages_600ml"], grade),
                                (silicone["weatherseal_label"], silicone["weatherseal_sausages_600ml"], "dowsil_795")):
            rate = pr["sealants"].get(key, SEALANTS.get(key, {}).get("price_inr", 0))
            lines.append({"category": "Sealant", "item": f"{label} (600 ml)", "qty": qty, "unit": "sausage",
                          "rate": rate, "amount": qty * rate})

    lines += [
        {"category": "Hardware", "item": "Aluminium structural subframe & accessories", "qty": round(perimeter, 1),
         "unit": "rm", "rate": hw["aluminium_subframe_per_rm"], "amount": perimeter * hw["aluminium_subframe_per_rm"]},
        {"category": "Hardware", "item": "EPDM setting blocks & spacer tape", "qty": count, "unit": "set",
         "rate": hw["setting_blocks_per_panel"], "amount": count * hw["setting_blocks_per_panel"]},
        {"category": "Labour", "item": "Fabrication (cutting, edging, toughening handling)", "qty": round(panel_area, 2),
         "unit": "m²", "rate": lab["fabrication_per_sqm"], "amount": panel_area * lab["fabrication_per_sqm"]},
        {"category": "Labour", "item": "Site installation", "qty": round(panel_area, 2), "unit": "m²",
         "rate": lab["installation_per_sqm"], "amount": panel_area * lab["installation_per_sqm"]},
    ]
    if cutting:
        j = cutting["totals"]["jumbo_sheets"]
        lines.append({"category": "Logistics", "item": "Jumbo sheet transport & handling", "qty": j, "unit": "sheet",
                      "rate": lg["transport_per_jumbo"], "amount": j * lg["transport_per_jumbo"]})

    for ln in lines:
        ln["rate"] = round(ln["rate"], 2)
        ln["amount"] = round(ln["amount"], 2)
    cost = round(sum(ln["amount"] for ln in lines), 2)
    return {"lines": lines, "direct_cost": cost, "panel_area_m2": round(panel_area, 3),
            "perimeter_m": round(perimeter, 2), "panel_count": count}


def build_quote(bom: dict, margin_percent: float, gst_percent: float | None = None) -> dict:
    if not 0 <= margin_percent < 90 or math.isnan(margin_percent):
        raise ValueError("Margin must be between 0 and 90 %")
    gst_pct = DEFAULT_PRICES["commercial"]["gst_pct"] if gst_percent is None else gst_percent
    cost = bom["direct_cost"]
    # Margin on selling price: price = cost / (1 - m)
    subtotal = round(cost / (1 - margin_percent / 100), 2)
    profit = round(subtotal - cost, 2)
    gst = round(subtotal * gst_pct / 100, 2)
    total = round(subtotal + gst, 2)
    return {
        "margin_percent": margin_percent, "direct_cost": cost, "profit": profit,
        "subtotal": subtotal, "gst_percent": gst_pct, "gst": gst, "grand_total": total,
        "rate_per_sqm": round(subtotal / bom["panel_area_m2"], 2) if bom["panel_area_m2"] else 0,
    }
