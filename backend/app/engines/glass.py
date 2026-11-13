"""Glass specification catalogue and plate-theory strength/deflection checks.

Screening-level checks for four-edge supported rectangular glass under uniform
wind pressure (linear Kirchhoff plate theory, Roark coefficients). Linear theory
is conservative for large deflections. Final designs must be signed off by a
chartered facade engineer per IS 16231 / IS 875.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict

E_GLASS_MPA = 70_000.0

# Minimum thickness tolerances (mm) for nominal float thickness.
MIN_THICKNESS = {4: 3.78, 5: 4.57, 6: 5.56, 8: 7.42, 10: 9.02, 12: 11.91, 15: 14.29, 19: 18.26}

# Allowable design stress (MPa) for short-duration wind load.
ALLOWABLE_STRESS = {"annealed": 17.0, "heat_strengthened": 35.0, "toughened": 50.0}

# Indicative supply rates (INR per m2), processed glass.
RATE_PER_SQM = {
    "6mm_toughened": 1100, "8mm_toughened": 1400, "10mm_toughened": 1800,
    "12mm_toughened": 2300, "15mm_toughened": 3400, "19mm_toughened": 4600,
    "11.52mm_laminated": 2600, "13.52mm_laminated": 3200,
    "17.52mm_laminated": 4200, "21.52mm_laminated": 5400,
}

# Candidate specs in ascending cost order, used for recommendations.
CANDIDATES_TOUGHENED = ["6mm_toughened", "8mm_toughened", "10mm_toughened",
                        "12mm_toughened", "15mm_toughened", "19mm_toughened"]
CANDIDATES_LAMINATED = ["11.52mm_laminated", "13.52mm_laminated",
                        "17.52mm_laminated", "21.52mm_laminated"]

# Roark Table 11.4 case 1a: simply supported on all edges, uniform load.
# ratio = long/short span; sigma = beta*q*b^2/t^2 ; w = alpha*q*b^4/(E*t^3)
_RATIOS = [1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 3.0, 4.0, 5.0, 1e9]
_BETA = [0.2874, 0.3762, 0.4530, 0.5172, 0.5688, 0.6102, 0.7134, 0.7410, 0.7476, 0.7500]
_ALPHA = [0.0444, 0.0616, 0.0770, 0.0906, 0.1017, 0.1110, 0.1335, 0.1400, 0.1417, 0.1421]


def _interp(x: float, xs: list[float], ys: list[float]) -> float:
    if x <= xs[0]:
        return ys[0]
    for i in range(1, len(xs)):
        if x <= xs[i]:
            x0, x1, y0, y1 = xs[i - 1], xs[i], ys[i - 1], ys[i]
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return ys[-1]


@dataclass
class GlassSpec:
    key: str
    label: str
    kind: str  # monolithic | laminated
    treatment: str  # annealed | heat_strengthened | toughened
    plies_mm: list[int]
    interlayer_mm: float
    nominal_mm: float

    @property
    def t_stress(self) -> float:
        """Effective thickness for stress (no interlayer shear transfer, conservative)."""
        ts = [MIN_THICKNESS.get(p, p * 0.95) for p in self.plies_mm]
        if len(ts) == 1:
            return ts[0]
        t_max = max(ts)
        return (sum(t ** 3 for t in ts) / t_max) ** 0.5

    @property
    def t_deflection(self) -> float:
        ts = [MIN_THICKNESS.get(p, p * 0.95) for p in self.plies_mm]
        return sum(t ** 3 for t in ts) ** (1 / 3)

    @property
    def rate_per_sqm(self) -> float:
        if self.key in RATE_PER_SQM:
            return RATE_PER_SQM[self.key]
        # Fallback: scale by nominal thickness.
        base = 2300 / 12 if self.kind == "monolithic" else 3200 / 13.52
        return round(base * self.nominal_mm)

    def to_dict(self) -> dict:
        d = asdict(self)
        d["t_stress_mm"] = round(self.t_stress, 2)
        d["t_deflection_mm"] = round(self.t_deflection, 2)
        d["rate_per_sqm"] = self.rate_per_sqm
        return d


def parse_glass_spec(spec: str) -> GlassSpec:
    """Parse strings like '12mm_toughened', '13.52mm_laminated', '6+6 HS lam', '10 mm annealed'."""
    raw = (spec or "").strip().lower().replace(" ", "")
    if not raw:
        raise ValueError("Glass specification is empty")

    treatment = "toughened"
    if "annealed" in raw or "float" in raw:
        treatment = "annealed"
    elif "heat" in raw or "hs" in raw.replace("mm", ""):
        treatment = "heat_strengthened"

    is_lam = "lam" in raw or "+" in raw or "pvb" in raw or "sgp" in raw
    if is_lam:
        plus = re.findall(r"(\d+)\+(\d+)", raw)
        if plus:
            plies = [int(plus[0][0]), int(plus[0][1])]
            interlayer = 1.52
        else:
            m = re.search(r"(\d+(?:\.\d+)?)", raw)
            if not m:
                raise ValueError(f"Cannot read thickness from '{spec}'")
            total = float(m.group(1))
            interlayer = 1.52 if abs((total % 1) - 0.52) < 0.05 else 0.76
            ply = round((total - interlayer) / 2)
            plies = [ply, ply]
        if "toughened" not in raw and "tough" not in raw and treatment == "toughened":
            # Laminated facade glass is typically heat-strengthened unless stated.
            treatment = "heat_strengthened"
        nominal = sum(plies) + interlayer
        key = f"{nominal:g}mm_laminated"
        label = f"{plies[0]}+{plies[1]} mm laminated ({interlayer} PVB, {treatment.replace('_', '-')})"
        return GlassSpec(key, label, "laminated", treatment, plies, interlayer, nominal)

    m = re.search(r"(\d+(?:\.\d+)?)", raw)
    if not m:
        raise ValueError(f"Cannot read thickness from '{spec}'")
    t = int(round(float(m.group(1))))
    key = f"{t}mm_{treatment}"
    label = f"{t} mm {treatment.replace('_', '-')}"
    return GlassSpec(key, label, "monolithic", treatment, [t], 0.0, float(t))


def check_plate(spec: GlassSpec, width_mm: float, height_mm: float, pressure_kpa: float) -> dict:
    """Stress & deflection check for a four-edge supported pane."""
    a, b = max(width_mm, height_mm), min(width_mm, height_mm)
    ratio = a / b
    beta = _interp(ratio, _RATIOS, _BETA)
    alpha = _interp(ratio, _RATIOS, _ALPHA)
    q = pressure_kpa / 1000.0  # MPa (N/mm2)

    stress = beta * q * b ** 2 / spec.t_stress ** 2
    deflection = alpha * q * b ** 4 / (E_GLASS_MPA * spec.t_deflection ** 3)
    allow_stress = ALLOWABLE_STRESS[spec.treatment]
    allow_defl = min(b / 60.0, 25.0)

    stress_util = stress / allow_stress
    defl_util = deflection / allow_defl
    return {
        "aspect_ratio": round(ratio, 2),
        "max_stress_mpa": round(stress, 2),
        "allowable_stress_mpa": allow_stress,
        "stress_utilisation": round(stress_util, 3),
        "max_deflection_mm": round(deflection, 2),
        "allowable_deflection_mm": round(allow_defl, 1),
        "deflection_utilisation": round(defl_util, 3),
        "governing": "stress" if stress_util >= defl_util else "deflection",
        "utilisation": round(max(stress_util, defl_util), 3),
        "pass": stress_util <= 1.0 and defl_util <= 1.0,
    }


def recommend(width_mm: float, height_mm: float, pressure_kpa: float, treatment_family: str) -> dict | None:
    pool = CANDIDATES_TOUGHENED if treatment_family == "toughened" else CANDIDATES_LAMINATED
    for key in pool:
        spec = parse_glass_spec(key)
        res = check_plate(spec, width_mm, height_mm, pressure_kpa)
        if res["pass"]:
            return {"glass_spec": key, "label": spec.label, **res}
    return None


def catalogue() -> list[dict]:
    return [parse_glass_spec(k).to_dict() for k in CANDIDATES_TOUGHENED + CANDIDATES_LAMINATED]
