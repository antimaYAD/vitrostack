"""IS 875 (Part 3): 2015 design wind pressure for cladding / glazing.

Vz = Vb * k1 * k2 * k3 * k4
pz = 0.6 * Vz^2                          (N/m2)
pd = max(Kd * Ka * Kc * pz, 0.7 * pz)
p_design = pd * Cp_net                   (cladding pressure)
"""
from __future__ import annotations

from .glass import check_plate, parse_glass_spec, recommend

# Basic wind speed Vb (m/s), IS 875-3 Annex A.
BASIC_WIND_SPEED = {
    "agra": 47, "ahmedabad": 39, "ajmer": 47, "amritsar": 47, "aurangabad": 39,
    "bengaluru": 33, "bangalore": 33, "bhopal": 39, "bhubaneswar": 50, "chandigarh": 47,
    "chennai": 50, "coimbatore": 39, "cuttack": 50, "darbhanga": 55, "dehradun": 47,
    "delhi": 47, "new delhi": 47, "gurugram": 47, "gurgaon": 47, "noida": 47,
    "goa": 39, "panaji": 39, "guwahati": 50, "hyderabad": 44, "indore": 47, "jaipur": 47,
    "jammu": 39, "jamshedpur": 47, "jodhpur": 47, "kanpur": 47, "kochi": 39, "cochin": 39,
    "kolkata": 50, "kozhikode": 39, "lucknow": 47, "ludhiana": 47, "madurai": 39,
    "mangaluru": 39, "mangalore": 39, "mumbai": 44, "navi mumbai": 44, "thane": 44,
    "mysuru": 33, "mysore": 33, "nagpur": 44, "nashik": 39, "patna": 47, "pondicherry": 50,
    "puducherry": 50, "pune": 39, "raipur": 39, "rajkot": 39, "ranchi": 39, "shimla": 39,
    "srinagar": 39, "surat": 44, "thiruvananthapuram": 39, "trivandrum": 39,
    "tiruchirappalli": 47, "vadodara": 44, "varanasi": 47, "vijayawada": 50,
    "visakhapatnam": 50, "vizag": 50, "bhuj": 50, "kandla": 50,
}

# k2 terrain & height factor, IS 875-3:2015 Table 2.
_K2_HEIGHTS = [10, 15, 20, 30, 50, 100, 150, 200, 250, 300, 350, 400, 450, 500]
_K2 = {
    1: [1.05, 1.09, 1.12, 1.15, 1.20, 1.26, 1.30, 1.32, 1.34, 1.36, 1.37, 1.38, 1.39, 1.40],
    2: [1.00, 1.05, 1.07, 1.12, 1.17, 1.24, 1.28, 1.30, 1.32, 1.34, 1.35, 1.37, 1.38, 1.39],
    3: [0.91, 0.97, 1.01, 1.06, 1.12, 1.20, 1.24, 1.27, 1.29, 1.31, 1.32, 1.34, 1.35, 1.37],
    4: [0.80, 0.80, 0.80, 0.97, 1.10, 1.20, 1.24, 1.27, 1.29, 1.31, 1.32, 1.34, 1.35, 1.37],
}

TERRAIN_LABELS = {
    1: "Category 1 – open sea coast / flat open terrain",
    2: "Category 2 – open terrain with scattered obstructions",
    3: "Category 3 – suburban / dense low-rise urban",
    4: "Category 4 – city centre with tall buildings",
}

ZONES = {
    "typical": {"cp_net": 1.2, "label": "Typical facade zone (Cpe −1.0, Cpi ±0.2)"},
    "corner": {"cp_net": 1.7, "label": "Corner / edge zone (local Cpe −1.5, Cpi ±0.2)"},
}

FLOOR_TO_FLOOR_M = 3.3


class UnknownCityError(ValueError):
    pass


def basic_wind_speed(city: str) -> tuple[str, float]:
    key = (city or "").strip().lower()
    if key in BASIC_WIND_SPEED:
        return key.title(), BASIC_WIND_SPEED[key]
    for name, v in BASIC_WIND_SPEED.items():
        if name in key or key in name and len(key) >= 4:
            return name.title(), v
    raise UnknownCityError(
        f"No IS 875 basic wind speed on file for '{city}'. Provide Vb (m/s) or pick a nearby city."
    )


def k2_factor(height_m: float, terrain: int) -> float:
    hs, ks = _K2_HEIGHTS, _K2[terrain]
    h = max(height_m, 10.0)
    if h >= hs[-1]:
        return ks[-1]
    for i in range(1, len(hs)):
        if h <= hs[i]:
            return round(ks[i - 1] + (ks[i] - ks[i - 1]) * (h - hs[i - 1]) / (hs[i] - hs[i - 1]), 4)
    return ks[-1]


def design_pressure(city: str, height_m: float, terrain: int = 3, zone: str = "typical",
                    vb_override: float | None = None, k1: float = 1.0, k3: float = 1.0,
                    k4: float = 1.0) -> dict:
    if height_m <= 0 or height_m > 500:
        raise ValueError("Building height must be between 0 and 500 m")
    if terrain not in _K2:
        raise ValueError("Terrain category must be 1–4")
    if zone not in ZONES:
        raise ValueError(f"Zone must be one of {list(ZONES)}")

    city_name, vb = (city.title(), vb_override) if vb_override else basic_wind_speed(city)
    k2 = k2_factor(height_m, terrain)
    vz = vb * k1 * k2 * k3 * k4
    pz = 0.6 * vz ** 2 / 1000.0  # kPa
    kd, ka, kc = 0.9, 1.0, 1.0
    pd = max(kd * ka * kc * pz, 0.7 * pz)
    cp_net = ZONES[zone]["cp_net"]
    p_design = pd * cp_net
    return {
        "city": city_name,
        "height_m": round(height_m, 2),
        "terrain_category": terrain,
        "terrain_label": TERRAIN_LABELS[terrain],
        "zone": zone,
        "zone_label": ZONES[zone]["label"],
        "factors": {"Vb": vb, "k1": k1, "k2": k2, "k3": k3, "k4": k4,
                    "Kd": kd, "Ka": ka, "Kc": kc, "Cp_net": cp_net},
        "Vz_mps": round(vz, 2),
        "pz_kpa": round(pz, 3),
        "pd_kpa": round(pd, 3),
        "design_pressure_kpa": round(p_design, 3),
    }


def calculate_is875_wind_load(city: str, building_height_m: float, window_width_mm: int,
                              window_height_mm: int, glass_spec: str, terrain: int = 3,
                              zone: str = "typical") -> dict:
    if window_width_mm <= 0 or window_height_mm <= 0:
        raise ValueError("Window dimensions must be positive")
    wind = design_pressure(city, building_height_m, terrain, zone)
    spec = parse_glass_spec(glass_spec)
    plate = check_plate(spec, window_width_mm, window_height_mm, wind["design_pressure_kpa"])

    rec_t = recommend(window_width_mm, window_height_mm, wind["design_pressure_kpa"], "toughened")
    rec_l = recommend(window_width_mm, window_height_mm, wind["design_pressure_kpa"], "laminated")
    recommended = None
    if not plate["pass"]:
        recommended = (rec_t or rec_l or {}).get("glass_spec")

    return {
        **wind,
        "window_width_mm": window_width_mm,
        "window_height_mm": window_height_mm,
        "glass_spec": spec.key,
        "glass_label": spec.label,
        "check": plate,
        "safe": plate["pass"],
        "recommended_glass_spec": recommended,
        "min_safe_toughened": rec_t,
        "min_safe_laminated": rec_l,
        "assumptions": [
            "Four-edge structurally supported pane, linear plate theory (conservative).",
            "Importance k1=1.0, topography k3=1.0, cyclonic k4=1.0 unless overridden.",
            "Deflection limit: lesser of short span/60 and 25 mm.",
            "Screening check – final design requires facade engineer sign-off.",
        ],
    }
