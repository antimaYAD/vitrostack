"""Structural silicone sizing (ASTM C1401 / sealant manufacturer method).

bite (mm) = 0.5 * short_span (mm) * wind_pressure (kPa) / design_strength (kPa)
Design strength for structural silicone = 138 kPa (20 psi).
"""
from __future__ import annotations

import math

SEALANTS = {
    "dowsil_995": {"label": "DOWSIL 995 Structural Silicone", "design_strength_kpa": 138.0,
                   "sausage_ml": 600, "price_inr": 1150, "role": "structural"},
    "dowsil_993": {"label": "DOWSIL 993 Structural Glazing (2-part)", "design_strength_kpa": 138.0,
                   "sausage_ml": 600, "price_inr": 980, "role": "structural"},
    "dowsil_795": {"label": "DOWSIL 795 Weatherseal", "design_strength_kpa": 138.0,
                   "sausage_ml": 600, "price_inr": 650, "role": "weatherseal"},
}

MIN_BITE_MM = 6.0
MIN_GLUELINE_MM = 6.0
WASTAGE_FACTOR = 1.10


def calculate_structural_silicone(wind_pressure_kpa: float, short_span_mm: int, perimeter_m: float,
                                  sealant_grade: str = "dowsil_995", panel_count: int = 1,
                                  weatherseal_joint_mm: float = 12.0,
                                  sealant_prices: dict | None = None) -> dict:
    if wind_pressure_kpa <= 0 or short_span_mm <= 0 or perimeter_m <= 0:
        raise ValueError("Pressure, short span and perimeter must be positive")
    grade = sealant_grade if sealant_grade in SEALANTS else "dowsil_995"
    s = SEALANTS[grade]

    raw_bite = 0.5 * short_span_mm * wind_pressure_kpa / s["design_strength_kpa"]
    bite = int(max(MIN_BITE_MM, math.ceil(raw_bite)))
    # Glueline thickness: >= 6 mm and bite:thickness ratio between 1:1 and 3:1.
    glueline = int(max(MIN_GLUELINE_MM, math.ceil(bite / 3)))

    structural_ml_per_panel = bite * glueline * perimeter_m * 1000 / 1000  # mm2 * mm -> ml
    total_structural_ml = structural_ml_per_panel * panel_count * WASTAGE_FACTOR
    sausages = math.ceil(total_structural_ml / s["sausage_ml"])

    # Weatherseal (795) between panels: joint width x 6 mm depth, along perimeter / 2 (shared joints).
    ws = SEALANTS["dowsil_795"]
    ws_ml = weatherseal_joint_mm * 6 * perimeter_m * panel_count / 2 * WASTAGE_FACTOR
    ws_sausages = math.ceil(ws_ml / ws["sausage_ml"])

    return {
        "sealant_grade": grade,
        "sealant_label": s["label"],
        "calculated_bite_mm": round(raw_bite, 2),
        "bite_mm": bite,
        "glueline_thickness_mm": glueline,
        "bite_to_thickness_ratio": round(bite / glueline, 2),
        "structural_ml_per_panel": round(structural_ml_per_panel, 1),
        "panel_count": panel_count,
        "structural_sausages_600ml": sausages,
        "structural_cost_inr": sausages * (sealant_prices or {}).get(grade, s["price_inr"]),
        "weatherseal_label": ws["label"],
        "weatherseal_sausages_600ml": ws_sausages,
        "weatherseal_cost_inr": ws_sausages * (sealant_prices or {}).get("dowsil_795", ws["price_inr"]),
        "governed_by_minimum": raw_bite < MIN_BITE_MM,
        "notes": [
            f"Design strength {s['design_strength_kpa']:.0f} kPa (20 psi) per ASTM C1401.",
            "Minimum bite 6 mm, minimum glueline 6 mm, bite:thickness ≤ 3:1.",
            "Includes 10% application wastage. Dead load assumed carried by setting blocks.",
        ],
    }
