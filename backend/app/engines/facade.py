"""Facade elevation engine: net glass sizes, IS 875 pane checks, silicone butt joints and BOM.

An elevation is a row of bays (left to right) separated by vertical joints. Each bay can be split into
panes (top to bottom) by aluminium transoms. A vertical joint is either an aluminium mullion or an
8 mm structural-silicone butt joint (no metal; the glass edges are flat-polished and exposed).

Conventions (all mm, y measured down from the top of the elevation):
- Bay widths are module widths: outer frame edge or joint centreline to joint centreline. They sum to the
  overall width. Pane heights do the same within a bay.
- Sight line of an edge: outer frame -> frame_mm, mullion -> mullion_mm / 2, transom -> transom_mm / 2,
  butt joint -> gap_mm / 2.
- Glass sits `REBATE_MM` into every profile pocket (frame, mullion, transom). A butt-jointed edge has no
  pocket, so the glass stops at the silicone gap.
- Vents (casement, top-hung, tilt & turn, door) sit in a sash `SASH_MM` wide inside the sight opening.
- Frameless sliders run in a top/bottom track and overlap the neighbouring bay by `SLIDE_OVERLAP_MM`.

Support conditions for the plate check:
- Four edges in profiles -> four-edge supported plate (engines.glass.check_plate).
- A butt joint with no backing leaves both glass edges free. A pane with a free vertical edge, or a frameless
  slider, is treated as spanning one way between its top and bottom supports (simply supported strip).
  This is conservative for three-edge support. A butt joint backed by a glass fin supports both edges.

Deductions are typical values for screening. Replace them with your system supplier's figures before
releasing cut lists to the factory.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

from .glass import ALLOWABLE_STRESS, E_GLASS_MPA, check_plate, parse_glass_spec
from .silicone import MIN_BITE_MM, SEALANTS, WASTAGE_FACTOR

REBATE_MM = 12
SASH_MM = 55
SLIDE_OVERLAP_MM = 50
MIN_BAY_MM = 200
MIN_PANE_MM = 150
GLASS_DENSITY_KG_M2_MM = 2.5

OPERATIONS = {
    "fixed": "Fixed (F)",
    "sliding_left": "Sliding left (←)",
    "sliding_right": "Sliding right (→)",
    "casement": "Casement vent",
    "top_hung": "Top-hung vent",
    "tilt_turn": "Tilt & turn vent",
    "door": "Door",
}
SLIDING = {"sliding_left", "sliding_right"}
# Openable panes in an aluminium sash. A door is a vent that must sit on the sill.
VENTS = {"casement", "top_hung", "tilt_turn", "door"}

# Non-glass infills are fixed panels: no glass check, listed separately in the BOM.
INFILLS = {"glass": "Glass", "spandrel": "Spandrel panel", "louvre": "Louvre"}

# check: spec used for the plate check; load_share: fraction of the wind load each lite carries;
# cut: lites to cut per unit (spec, count) for the cutting optimiser.
GLASS = {
    "10mm_toughened": {"label": "10 mm toughened", "short": "10T", "check": "10mm_toughened", "load_share": 1.0,
                       "thickness_mm": 10.0, "glass_mm": 10.0, "cut": [("10mm_toughened", 1)]},
    "12mm_toughened": {"label": "12 mm toughened", "short": "12T", "check": "12mm_toughened", "load_share": 1.0,
                       "thickness_mm": 12.0, "glass_mm": 12.0, "cut": [("12mm_toughened", 1)]},
    "13.52mm_laminated_toughened": {
        "label": "13.52 mm laminated toughened (6 + 1.52 PVB + 6)", "short": "13.52 LT",
        "check": "13.52mm_laminated_toughened", "load_share": 1.0, "thickness_mm": 13.52, "glass_mm": 12.0,
        "cut": [("13.52mm_laminated", 1)]},
    "24mm_dgu": {
        "label": "24 mm DGU (6 T + 12 air + 6 T)", "short": "24 DGU", "check": "6mm_toughened",
        # Equal 6 mm lites share the load about equally through the sealed air space.
        "load_share": 0.5, "thickness_mm": 24.0, "glass_mm": 12.0, "cut": [("6mm_toughened", 2)]},
}

TRACKS = {
    # deduction: glass height lost to rollers / guide clearance; max_panel_kg: roller rating per panel.
    "2_track_recessed": {"label": "2-track recessed", "tracks": 2, "deduction_mm": 10, "max_panel_kg": 120},
    "3_track_heavy_duty": {"label": "3-track heavy duty", "tracks": 3, "deduction_mm": 14, "max_panel_kg": 250},
}

JOINTS = {"aluminum_mullion": "Aluminium mullion", "silicone_butt_joint": "Silicone butt joint"}


def sealant_key(name: str | None) -> str:
    n = (name or "").lower()
    for k in SEALANTS:
        if k.split("_")[-1] in n and SEALANTS[k]["role"] == "structural":
            return k
    return "dowsil_995"


# ---------------------------------------------------------------- normalised model

@dataclass
class Pane:
    bay_index: int
    pane_index: int
    mark: str
    y_mm: int
    height_mm: int
    operation: str
    glass_spec: str
    track_system: str | None
    infill: str = "glass"
    # filled by analyse()
    sight: tuple[float, float, float, float] = (0, 0, 0, 0)  # x, y, w, h
    glass: tuple[float, float, float, float] = (0, 0, 0, 0)
    edges: dict = field(default_factory=dict)  # left/right/top/bottom -> frame|mullion|transom|butt|track|overlap
    one_way: bool = False


@dataclass
class Bay:
    bay_index: int
    x_mm: int
    width_mm: int
    right_joint: dict | None
    panes: list[Pane]


@dataclass
class Elevation:
    elevation_id: str
    width_mm: int
    height_mm: int
    wind_pressure_kpa: float
    frame_mm: int
    mullion_mm: int
    transom_mm: int
    quantity: int
    bays: list[Bay]
    issues: list[dict]


def _letter(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def normalise(data: dict) -> Elevation:
    """Turn the parametric JSON (already schema-validated) into positioned bays and panes."""
    W, H = int(data["overall_width_mm"]), int(data["overall_height_mm"])
    raw_bays = sorted(data["bays"], key=lambda b: b["bay_index"])
    if not raw_bays:
        raise ValueError("The elevation needs at least one bay")
    total = sum(int(b["width_mm"]) for b in raw_bays)
    if abs(total - W) > 1:
        raise ValueError(f"Bay widths add up to {total} mm but the overall width is {W} mm")
    frame = int(data.get("frame_mm") or 50)
    mullion = int(data.get("mullion_mm") or 50)
    transom = int(data.get("transom_mm") or 50)
    eid = data["elevation_id"]

    bays: list[Bay] = []
    x = 0
    for bi, b in enumerate(raw_bays, start=1):
        bw = int(b["width_mm"])
        if bw < MIN_BAY_MM:
            raise ValueError(f"Bay {bi} is {bw} mm wide; the minimum is {MIN_BAY_MM} mm")
        if b.get("height_mm") and abs(int(b["height_mm"]) - H) > 1:
            raise ValueError(f"Bay {bi} is {b['height_mm']} mm high but the elevation is {H} mm")
        raw_panes = b.get("panes") or [{"pane_index": 1, "height_mm": H, "operation": b.get("operation") or "fixed",
                                        "glass_spec": b.get("glass_spec") or "12mm_toughened",
                                        "track_system": b.get("track_system"),
                                        "infill": b.get("infill") or "glass"}]
        raw_panes = sorted(raw_panes, key=lambda p: p.get("pane_index", 0))
        ph_total = sum(int(p["height_mm"]) for p in raw_panes)
        if abs(ph_total - H) > 1:
            raise ValueError(f"Pane heights in bay {bi} add up to {ph_total} mm but the elevation is {H} mm")
        panes, y = [], 0
        for pi, p in enumerate(raw_panes):
            ph = int(p["height_mm"])
            if ph < MIN_PANE_MM:
                raise ValueError(f"Pane {bi}{_letter(pi)} is {ph} mm high; the minimum is {MIN_PANE_MM} mm")
            op = p.get("operation") or "fixed"
            infill = p.get("infill") or "glass"
            if infill not in INFILLS:
                raise ValueError(f"Unknown infill {infill!r}")
            track = (p.get("track_system") or "2_track_recessed") if op in SLIDING else None
            panes.append(Pane(bi, pi + 1, f"{eid}/B{bi}-{_letter(pi)}", y, ph, op,
                              p.get("glass_spec") or "12mm_toughened", track, infill))
            y += ph
        joint = b.get("right_joint") if bi < len(raw_bays) else None
        bays.append(Bay(bi, x, bw, joint, panes))
        x += bw

    e = Elevation(eid, W, H, float(data["wind_pressure_kpa"]), frame, mullion, transom,
                  int(data.get("quantity") or 1), bays, [])
    _analyse(e)
    return e


def _joint_type(j: dict | None) -> str | None:
    return (j or {}).get("type")


def _fin(j: dict | None) -> bool:
    return (j or {}).get("backing") == "glass_fin"


def _gap(j: dict | None) -> float:
    return float((j or {}).get("gap_mm") or 8)


def _analyse(e: Elevation) -> None:
    """Sight openings, net glass sizes, edge conditions and design issues."""
    n = len(e.bays)
    for i, bay in enumerate(e.bays):
        left_j = e.bays[i - 1].right_joint if i > 0 else None
        right_j = bay.right_joint if i < n - 1 else None
        left_kind = "frame" if i == 0 else ("butt" if _joint_type(left_j) == "silicone_butt_joint" else "mullion")
        right_kind = "frame" if i == n - 1 else ("butt" if _joint_type(right_j) == "silicone_butt_joint" else "mullion")
        left_free = left_kind == "butt" and not _fin(left_j)
        right_free = right_kind == "butt" and not _fin(right_j)

        def v_ded(kind: str, j: dict | None) -> float:
            return {"frame": e.frame_mm, "mullion": e.mullion_mm / 2, "butt": _gap(j) / 2}[kind]

        sx = bay.x_mm + v_ded(left_kind, left_j)
        sw = bay.width_mm - v_ded(left_kind, left_j) - v_ded(right_kind, right_j)
        np_ = len(bay.panes)
        for k, p in enumerate(bay.panes):
            top_kind = "frame" if k == 0 else "transom"
            bot_kind = "frame" if k == np_ - 1 else "transom"
            td = e.frame_mm if top_kind == "frame" else e.transom_mm / 2
            bd = e.frame_mm if bot_kind == "frame" else e.transom_mm / 2
            sy, sh = p.y_mm + td, p.height_mm - td - bd
            p.sight = (sx, sy, sw, sh)
            if sw < 80 or sh < 80:
                raise ValueError(f"Pane {p.mark} has no clear opening left after the profile widths")

            if p.operation in VENTS:
                gx, gy = sx + SASH_MM - REBATE_MM, sy + SASH_MM - REBATE_MM
                gw, gh = sw - 2 * (SASH_MM - REBATE_MM), sh - 2 * (SASH_MM - REBATE_MM)
                edges = {"left": "sash", "right": "sash", "top": "sash", "bottom": "sash"}
            elif p.operation in SLIDING:
                t = TRACKS[p.track_system]
                lo = SLIDE_OVERLAP_MM if left_kind != "frame" else REBATE_MM
                ro = SLIDE_OVERLAP_MM if right_kind != "frame" else REBATE_MM
                gx, gw = sx - lo, sw + lo + ro
                # The panel runs in the head and sill tracks; rollers and guides take `deduction_mm`.
                gy = sy - REBATE_MM + t["deduction_mm"] / 2
                gh = sh + 2 * REBATE_MM - t["deduction_mm"]
                edges = {"left": "overlap" if left_kind != "frame" else "frame",
                         "right": "overlap" if right_kind != "frame" else "frame", "top": "track", "bottom": "track"}
            else:
                lr = 0 if left_kind == "butt" else REBATE_MM
                rr = 0 if right_kind == "butt" else REBATE_MM
                gx, gw = sx - lr, sw + lr + rr
                gy, gh = sy - REBATE_MM, sh + 2 * REBATE_MM
                edges = {"left": left_kind, "right": right_kind, "top": top_kind, "bottom": bot_kind}
            p.glass = (gx, gy, round(gw), round(gh))
            p.edges = edges
            p.one_way = p.operation in SLIDING or (p.operation not in VENTS and (left_free or right_free))

            # Design issues that make the pane unbuildable as drawn.
            if p.infill != "glass" and p.operation != "fixed":
                e.issues.append({"level": "error", "bay_index": bay.bay_index, "pane_index": p.pane_index,
                                 "message": f"{p.mark}: a {INFILLS[p.infill].lower()} can't open. Make it fixed or change the infill to glass."})
            if p.infill != "glass" and "butt" in (left_kind, right_kind):
                e.issues.append({"level": "error", "bay_index": bay.bay_index, "pane_index": p.pane_index,
                                 "message": f"{p.mark}: a {INFILLS[p.infill].lower()} can't be silicone butt-jointed. Change the butt joint next to it to a mullion."})
            if p.operation == "door" and k != np_ - 1:
                e.issues.append({"level": "error", "bay_index": bay.bay_index, "pane_index": p.pane_index,
                                 "message": f"{p.mark}: a door must be the bottom pane of its bay."})
            if p.operation == "door" and p.height_mm < 1900:
                e.issues.append({"level": "warning", "bay_index": bay.bay_index, "pane_index": p.pane_index,
                                 "message": f"{p.mark}: the door opening is only {p.height_mm} mm high; 2100 mm is typical."})
            if p.operation in VENTS and "butt" in (left_kind, right_kind):
                e.issues.append({"level": "error", "bay_index": bay.bay_index, "pane_index": p.pane_index,
                                 "message": f"{p.mark}: a vent needs a profile on all four sides. Change the butt joint next to it to a mullion."})
            if p.operation in SLIDING and "butt" in (left_kind, right_kind):
                e.issues.append({"level": "error", "bay_index": bay.bay_index, "pane_index": p.pane_index,
                                 "message": f"{p.mark}: a sliding panel can't be silicone-bonded. Change the butt joint next to it to a mullion."})
            if p.operation in SLIDING and np_ > 1:
                e.issues.append({"level": "warning", "bay_index": bay.bay_index, "pane_index": p.pane_index,
                                 "message": f"{p.mark}: the slider sits between transoms; check the track can be fixed to the transom."})
            if p.glass_spec == "24mm_dgu" and "butt" in (edges["left"], edges["right"]):
                e.issues.append({"level": "warning", "bay_index": bay.bay_index, "pane_index": p.pane_index,
                                 "message": f"{p.mark}: DGU butt joints need a stepped or structurally sealed edge; confirm with the IGU supplier."})

    # Transoms must line up across a butt joint, or the silicone seal has nothing continuous to bond to.
    for i in range(n - 1):
        if _joint_type(e.bays[i].right_joint) == "silicone_butt_joint":
            a = [p.y_mm for p in e.bays[i].panes[1:]]
            b = [p.y_mm for p in e.bays[i + 1].panes[1:]]
            if a != b:
                e.issues.append({"level": "warning", "bay_index": i + 1, "pane_index": None,
                                 "message": f"Butt joint between bays {i + 1} and {i + 2}: the transoms don't line up, so the seal is interrupted by a transom on one side."})


# ---------------------------------------------------------------- checks

def _one_way(spec_key: str, span_mm: float, q_kpa: float) -> dict:
    spec = parse_glass_spec(spec_key)
    q = q_kpa / 1000.0  # N/mm²
    stress = 0.75 * q * span_mm ** 2 / spec.t_stress ** 2
    deflection = 5 * 12 * q * span_mm ** 4 / (384 * E_GLASS_MPA * spec.t_deflection ** 3)
    allow_s = ALLOWABLE_STRESS[spec.treatment]
    allow_d = min(span_mm / 60.0, 25.0)
    su, du = stress / allow_s, deflection / allow_d
    return {"aspect_ratio": None, "max_stress_mpa": round(stress, 2), "allowable_stress_mpa": allow_s,
            "stress_utilisation": round(su, 3), "max_deflection_mm": round(deflection, 2),
            "allowable_deflection_mm": round(allow_d, 1), "deflection_utilisation": round(du, 3),
            "governing": "stress" if su >= du else "deflection", "utilisation": round(max(su, du), 3),
            "pass": su <= 1.0 and du <= 1.0}


def pane_check(glass_spec: str, w: float, h: float, pressure_kpa: float, one_way: bool) -> dict:
    g = GLASS[glass_spec]
    q = pressure_kpa * g["load_share"]
    if one_way:
        return _one_way(g["check"], h, q)
    return check_plate(parse_glass_spec(g["check"]), w, h, q)


def weight_kg(glass_spec: str, w: float, h: float) -> float:
    return w * h / 1e6 * GLASS[glass_spec]["glass_mm"] * GLASS_DENSITY_KG_M2_MM


def required_bite(pressure_kpa: float, short_span_mm: float, sealant: str) -> tuple[float, int]:
    """B = (P × short span) / (2 × design strength), rounded up, never below the 6 mm minimum."""
    strength = SEALANTS[sealant_key(sealant)]["design_strength_kpa"]
    raw = pressure_kpa * short_span_mm / (2 * strength)
    return round(raw, 2), int(max(MIN_BITE_MM, math.ceil(raw)))


def _joint_panes(e: Elevation, i: int) -> list[Pane]:
    """Glass panes bonded into the joint right of bay i (non-glass infills there are flagged as errors)."""
    ps = [p for p in e.bays[i].panes] + [p for p in e.bays[i + 1].panes]
    return [p for p in ps if p.infill == "glass"] or ps


def validate(e: Elevation) -> dict:
    P = e.wind_pressure_kpa
    panes_out = []
    for bay in e.bays:
        for p in bay.panes:
            gw, gh = p.glass[2], p.glass[3]
            if p.infill != "glass":
                panes_out.append({
                    "bay_index": bay.bay_index, "pane_index": p.pane_index, "mark": p.mark, "infill": p.infill,
                    "glass_spec": p.glass_spec, "glass_width_mm": gw, "glass_height_mm": gh, "support": "n/a",
                    "weight_kg": 0, "max_stress_mpa": 0, "allowable_stress_mpa": 0, "max_deflection_mm": 0,
                    "allowable_deflection_mm": 0, "governing": "stress", "utilisation": 0, "pass": True,
                    "plate_pass": True, "warnings": [], "recommended_glass_spec": None,
                    "hint": f"{INFILLS[p.infill]}: no glass check. Check the panel with its supplier."})
                continue
            c = pane_check(p.glass_spec, gw, gh, P, p.one_way)
            warnings = []
            kg = weight_kg(p.glass_spec, gw, gh)
            if p.operation in SLIDING:
                t = TRACKS[p.track_system]
                if kg > t["max_panel_kg"]:
                    warnings.append(f"{kg:.0f} kg panel exceeds the {t['label']} roller rating of {t['max_panel_kg']} kg")
            recommended = None
            if not c["pass"]:
                for alt in GLASS:
                    if alt != p.glass_spec and pane_check(alt, gw, gh, P, p.one_way)["pass"]:
                        recommended = alt
                        break
            hint = None
            if not c["pass"]:
                if p.operation in SLIDING:
                    hint = "Use thicker glass or add a transom to shorten the span."
                elif p.one_way:
                    hint = "The butt-jointed edge is unsupported. Back the joint with a glass fin, or use a mullion."
                elif not recommended:
                    hint = "Add a mullion or transom to reduce the pane size."
            ok = c["pass"] and not warnings
            panes_out.append({
                "bay_index": bay.bay_index, "pane_index": p.pane_index, "mark": p.mark, "infill": "glass",
                "glass_spec": p.glass_spec, "glass_width_mm": gw, "glass_height_mm": gh,
                "support": "two-edge (spans top to bottom)" if p.one_way else "four-edge",
                "weight_kg": round(kg, 1), **c, "pass": ok, "plate_pass": c["pass"], "warnings": warnings,
                "recommended_glass_spec": recommended, "hint": hint,
            })

    joints = []
    for i, bay in enumerate(e.bays[:-1]):
        j = bay.right_joint or {"type": "aluminum_mullion"}
        out = {"after_bay": bay.bay_index, "type": j["type"]}
        if j["type"] == "silicone_butt_joint":
            spans = [min(p.glass[2], p.glass[3]) for p in _joint_panes(e, i)]
            raw, bite = required_bite(P, max(spans), j.get("sealant"))
            depth = min(GLASS[p.glass_spec]["thickness_mm"] for p in _joint_panes(e, i))
            out.update({"gap_mm": _gap(j), "backing": j.get("backing") or "none",
                        "sealant": j.get("sealant") or "Dow_Dowsil_995",
                        "sealant_label": SEALANTS[sealant_key(j.get("sealant"))]["label"],
                        "short_span_mm": max(spans), "calculated_bite_mm": raw, "required_bite_mm": bite,
                        "joint_depth_mm": depth})
            if _fin(j):  # both panes bond to the fin's edge face: one bite each, plus the joint gap
                out["min_fin_thickness_mm"] = round(2 * bite + _gap(j), 1)
        else:
            out["profile_mm"] = e.mullion_mm
        joints.append(out)

    bays_out = []
    for bay in e.bays:
        mine = [p for p in panes_out if p["bay_index"] == bay.bay_index]
        errors = [x for x in e.issues if x["level"] == "error" and x["bay_index"] == bay.bay_index]
        bays_out.append({"bay_index": bay.bay_index, "pass": all(p["pass"] for p in mine) and not errors,
                         "max_utilisation": max(p["utilisation"] for p in mine)})
    return {
        "elevation_id": e.elevation_id, "wind_pressure_kpa": P,
        "pass": all(b["pass"] for b in bays_out),
        "summary": {"panes": len(panes_out), "failing": sum(not p["pass"] for p in panes_out),
                    "max_utilisation": max(p["utilisation"] for p in panes_out)},
        "panes": panes_out, "bays": bays_out, "joints": joints, "issues": e.issues,
        "assumptions": [
            "Plate check: linear theory, allowable stress 50 MPa toughened, deflection ≤ min(span/60, 25 mm).",
            "Butt joints without a glass fin and frameless sliders leave the vertical edges unsupported; those panes span top to bottom.",
            "24 mm DGU: each 6 mm toughened lite carries half the load.",
            f"Glass engages {REBATE_MM} mm into profiles; vents have a {SASH_MM} mm sash; sliders overlap {SLIDE_OVERLAP_MM} mm.",
            "Silicone bite B = P × short span / (2 × 138 kPa), minimum 6 mm.",
        ],
    }


# ---------------------------------------------------------------- BOM

def bom(e: Elevation) -> dict:
    q = e.quantity
    glass, cut, polished_m, infills = [], {}, 0.0, []
    by_spec: dict[str, dict] = {}
    for bay in e.bays:
        for p in bay.panes:
            gw, gh = p.glass[2], p.glass[3]
            if p.infill != "glass":
                infills.append({"mark": p.mark, "bay_index": bay.bay_index, "pane_index": p.pane_index,
                                "infill": p.infill, "label": INFILLS[p.infill], "width_mm": gw, "height_mm": gh,
                                "quantity": q, "area_m2": round(gw * gh / 1e6 * q, 3)})
                continue
            polished = [k for k in ("left", "right") if p.edges[k] in ("butt", "overlap")]
            if p.operation in SLIDING:
                polished = ["left", "right"]  # frameless panel: exposed vertical edges
            pm = len(polished) * gh / 1000
            polished_m += pm * q
            area = gw * gh / 1e6
            glass.append({"mark": p.mark, "bay_index": bay.bay_index, "pane_index": p.pane_index,
                          "operation": p.operation, "glass_spec": p.glass_spec,
                          "glass_label": GLASS[p.glass_spec]["label"], "width_mm": gw, "height_mm": gh,
                          "quantity": q, "area_m2": round(area * q, 3),
                          "weight_kg": round(weight_kg(p.glass_spec, gw, gh), 1),
                          "polished_edges": polished, "polished_edge_m": round(pm * q, 2)})
            s = by_spec.setdefault(p.glass_spec, {"glass_spec": p.glass_spec, "glass_label": GLASS[p.glass_spec]["label"],
                                                  "units": 0, "area_m2": 0.0})
            s["units"] += q
            s["area_m2"] += area * q
            for spec, n in GLASS[p.glass_spec]["cut"]:
                cut.setdefault((spec, gw, gh), 0)
                cut[(spec, gw, gh)] += n * q

    H, W = e.height_mm, e.width_mm
    alu = {"frame_m": 2 * (W + H) / 1000 * q, "mullion_m": 0.0, "transom_m": 0.0, "sash_m": 0.0}
    tracks: dict[str, float] = {}
    joint_m, joint_ml = 0.0, 0.0
    sealants: dict[str, float] = {}
    for i, bay in enumerate(e.bays):
        for p in bay.panes:
            sx, sy, sw, sh = p.sight
            if p.pane_index > 1:
                alu["transom_m"] += sw / 1000 * q
            if p.operation in VENTS:
                alu["sash_m"] += 2 * (sw + sh) / 1000 * q
            if p.operation in SLIDING:
                tracks[p.track_system] = tracks.get(p.track_system, 0) + 2 * sw / 1000 * q  # top + bottom
        if i < len(e.bays) - 1:
            j = bay.right_joint or {"type": "aluminum_mullion"}
            length = H - 2 * e.frame_mm
            if j["type"] == "silicone_butt_joint":
                depth = min(GLASS[p.glass_spec]["thickness_mm"] for p in _joint_panes(e, i))
                ml = _gap(j) * depth * length / 1000 * q  # mm³ -> ml
                joint_m += length / 1000 * q
                joint_ml += ml
                k = sealant_key(j.get("sealant"))
                sealants[k] = sealants.get(k, 0) + ml
            else:
                alu["mullion_m"] += length / 1000 * q

    sealant_lines = []
    for k, ml in sealants.items():
        s = SEALANTS[k]
        sausages = math.ceil(ml * WASTAGE_FACTOR / s["sausage_ml"])
        sealant_lines.append({"sealant": k, "label": s["label"], "net_ml": round(ml), "sausages_600ml": sausages,
                              "cost_inr": sausages * s["price_inr"]})

    return {
        "elevation_id": e.elevation_id, "quantity": q,
        "glass": glass,
        "infill_panels": infills,
        "glass_by_spec": [{**v, "area_m2": round(v["area_m2"], 2)} for v in by_spec.values()],
        "cutting_list": [{"glass_spec": s, "width_mm": w, "height_mm": h, "quantity": n} for (s, w, h), n in cut.items()],
        "aluminium": {**{k: round(v, 2) for k, v in alu.items()},
                      "tracks": [{"track_system": t, "label": TRACKS[t]["label"], "length_m": round(m, 2)} for t, m in tracks.items()],
                      "total_m": round(sum(alu.values()) + sum(tracks.values()), 2)},
        "silicone": {"butt_joint_m": round(joint_m, 2), "net_ml": round(joint_ml), "wastage_factor": WASTAGE_FACTOR,
                     "sausages_600ml": sum(x["sausages_600ml"] for x in sealant_lines), "lines": sealant_lines},
        "polished_edge_m": round(polished_m, 2),
        "totals": {"glass_units": sum(g["quantity"] for g in glass), "glass_area_m2": round(sum(g["area_m2"] for g in glass), 2),
                   "glass_weight_kg": round(sum(g["weight_kg"] for g in glass) * q, 1)},
        "issues": e.issues,
    }
