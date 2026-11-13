"""Default price list and helpers. Engines stay pure: callers pass the org's price list in."""
from __future__ import annotations

import copy

from .glass import CANDIDATES_LAMINATED, CANDIDATES_TOUGHENED, RATE_PER_SQM, GlassSpec, catalogue as _catalogue
from .silicone import SEALANTS

# Section -> {key: {label, unit, value}} is the UI schema; DEFAULT_PRICES is the flat value view.
PRICE_SCHEMA: dict[str, dict] = {
    "glass": {
        "title": "Glass", "description": "Supply rate for processed glass, charged on jumbo sheet area actually consumed.",
        "unit": "₹ / m²",
        "items": {k: {"label": k} for k in CANDIDATES_TOUGHENED + CANDIDATES_LAMINATED},
    },
    "sealants": {
        "title": "Sealants", "description": "Price per 600 ml sausage.", "unit": "₹ / sausage",
        "items": {k: {"label": v["label"]} for k, v in SEALANTS.items()},
    },
    "labour": {
        "title": "Labour", "description": "Charged on net panel area.", "unit": "₹ / m²",
        "items": {"fabrication_per_sqm": {"label": "Fabrication (cutting, edging, handling)"},
                  "installation_per_sqm": {"label": "Site installation"}},
    },
    "hardware": {
        "title": "Hardware & accessories", "description": "",
        "items": {"aluminium_subframe_per_rm": {"label": "Aluminium structural subframe", "unit": "₹ / running m"},
                  "setting_blocks_per_panel": {"label": "EPDM setting blocks & spacer tape", "unit": "₹ / panel"}},
    },
    "logistics": {
        "title": "Logistics", "description": "",
        "items": {"transport_per_jumbo": {"label": "Jumbo sheet transport & handling", "unit": "₹ / sheet"}},
    },
    "commercial": {
        "title": "Tax & margin", "description": "Defaults applied to new quotes.",
        "items": {"gst_pct": {"label": "GST", "unit": "%", "max": 28},
                  "default_margin_pct": {"label": "Default margin on selling price", "unit": "%", "max": 60}},
    },
}

DEFAULT_PRICES: dict[str, dict[str, float]] = {
    "glass": {k: float(RATE_PER_SQM[k]) for k in CANDIDATES_TOUGHENED + CANDIDATES_LAMINATED},
    "sealants": {k: float(v["price_inr"]) for k, v in SEALANTS.items()},
    "labour": {"fabrication_per_sqm": 450.0, "installation_per_sqm": 650.0},
    "hardware": {"aluminium_subframe_per_rm": 850.0, "setting_blocks_per_panel": 120.0},
    "logistics": {"transport_per_jumbo": 1500.0},
    "commercial": {"gst_pct": 18.0, "default_margin_pct": 18.0},
}


def defaults() -> dict:
    return copy.deepcopy(DEFAULT_PRICES)


def merged(overrides: dict | None) -> dict:
    out = defaults()
    for section, items in (overrides or {}).items():
        if section in out and isinstance(items, dict):
            for k, v in items.items():
                if k in out[section] and isinstance(v, (int, float)):
                    out[section][k] = float(v)
    return out


def glass_rate(spec: GlassSpec, prices: dict | None = None) -> float:
    table = (prices or DEFAULT_PRICES)["glass"]
    if spec.key in table:
        return table[spec.key]
    # Non-catalogue spec: scale from the nearest reference make-up in the current price list.
    if spec.kind == "monolithic":
        return round(table.get("12mm_toughened", 2300) / 12 * spec.nominal_mm)
    return round(table.get("13.52mm_laminated", 3200) / 13.52 * spec.nominal_mm)


def catalogue(prices: dict | None = None) -> list[dict]:
    rows = _catalogue()
    for r in rows:
        r["rate_per_sqm"] = (prices or DEFAULT_PRICES)["glass"].get(r["key"], r["rate_per_sqm"])
    return rows
