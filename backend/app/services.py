"""Project workflow operations shared by the REST API and the AI agent tools."""
from __future__ import annotations

import os
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import pricing
from .db import DEFAULT_ORG, Offcut, Panel, Project
from .engines import costing, cutting, silicone, wind
from .engines.glass import check_plate, parse_glass_spec, recommend

STORAGE = Path(os.getenv("VITRO_STORAGE", "./storage"))
STATUS_ORDER = ["draft", "validated", "optimized", "quoted"]


class NotFound(Exception):
    pass


def serialize_project(p: Project, full: bool = True) -> dict:
    panels = [{"id": x.id, "tag": x.tag, "width_mm": x.width_mm, "height_mm": x.height_mm,
               "quantity": x.quantity, "floor_level": x.floor_level, "notes": x.notes,
               "needs_review": x.needs_review} for x in p.panels]
    area = sum(x["width_mm"] * x["height_mm"] * x["quantity"] for x in panels) / 1e6
    d = {
        "id": p.id, "name": p.name, "client": p.client, "city": p.city,
        "building_height_m": p.building_height_m, "terrain": p.terrain, "zone": p.zone,
        "glass_spec": p.glass_spec, "glass_label": parse_glass_spec(p.glass_spec).label,
        "sealant_grade": p.sealant_grade, "glazing_system": p.glazing_system, "status": p.status,
        "panel_count": sum(x["quantity"] for x in panels), "panel_types": len(panels),
        "panel_area_m2": round(area, 2),
        "all_safe": (p.wind or {}).get("all_safe"),
        "design_pressure_kpa": (p.wind or {}).get("design_pressure_kpa"),
        "scrap_pct": (p.cutting or {}).get("totals", {}).get("scrap_pct"),
        "jumbo_sheets": (p.cutting or {}).get("totals", {}).get("jumbo_sheets"),
        "grand_total": (p.quote or {}).get("grand_total"),
        "created_at": p.created_at.isoformat() if p.created_at else None,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }
    if full:
        d.update({"panels": panels, "wind": p.wind, "silicone": p.silicone, "cutting": p.cutting,
                  "bom": p.bom, "quote": p.quote})
    return d


def get_project(db: Session, project_id: str, org: str = DEFAULT_ORG) -> Project:
    p = db.get(Project, project_id)
    if not p or p.organization_id != org:
        raise NotFound(f"Project {project_id} not found")
    return p


def _invalidate(p: Project, from_stage: str):
    """Downstream results are stale once an upstream input changes."""
    stages = {"wind": ["wind", "silicone", "cutting", "bom", "quote"],
              "cutting": ["cutting", "bom", "quote"], "quote": ["quote"]}
    for attr in stages[from_stage]:
        setattr(p, attr, None)
    p.status = "draft" if from_stage == "wind" else ("validated" if from_stage == "cutting" else p.status)


def create_project(db: Session, data: dict, org: str = DEFAULT_ORG) -> Project:
    wind.basic_wind_speed(data["city"])  # validate city early
    parse_glass_spec(data.get("glass_spec") or "12mm_toughened")
    p = Project(
        organization_id=org, name=data["name"], client=data.get("client"), city=data["city"].strip().title(),
        building_height_m=float(data["building_height_m"]), terrain=int(data.get("terrain") or 3),
        zone=data.get("zone") or "typical", glass_spec=data.get("glass_spec") or "12mm_toughened",
        sealant_grade=data.get("sealant_grade") or "dowsil_995", glazing_system=data.get("glazing_system"),
    )
    for i, x in enumerate(data.get("panels") or []):
        p.panels.append(Panel(tag=x.get("tag") or x.get("window_tag") or f"W{i + 1}",
                              width_mm=int(x["width_mm"]), height_mm=int(x["height_mm"]),
                              quantity=int(x.get("quantity") or 1), floor_level=x.get("floor_level"),
                              notes=x.get("notes") or x.get("glazing_notes"),
                              needs_review=bool(x.get("needs_review"))))
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


def update_project(db: Session, p: Project, data: dict) -> Project:
    engineering_fields = {"city", "building_height_m", "terrain", "zone", "glass_spec", "sealant_grade"}
    changed = False
    for k, v in data.items():
        if v is None or k == "panels":
            continue
        if k == "city":
            wind.basic_wind_speed(v)
        if k == "glass_spec":
            parse_glass_spec(v)
        if getattr(p, k) != v:
            setattr(p, k, v)
            changed = changed or k in engineering_fields
    if data.get("panels") is not None:
        p.panels.clear()
        for i, x in enumerate(data["panels"]):
            p.panels.append(Panel(tag=x.get("tag") or f"W{i + 1}", width_mm=int(x["width_mm"]),
                                  height_mm=int(x["height_mm"]), quantity=int(x.get("quantity") or 1),
                                  floor_level=x.get("floor_level"), notes=x.get("notes"),
                                  needs_review=bool(x.get("needs_review"))))
        changed = True
    if changed:
        _invalidate(p, "wind")
        release_offcuts(db, p.id)
    db.commit()
    db.refresh(p)
    return p


def run_wind_check(db: Session, p: Project) -> dict:
    if not p.panels:
        raise ValueError("Project has no panels to check")
    w = wind.design_pressure(p.city, p.building_height_m, p.terrain, p.zone)
    spec = parse_glass_spec(p.glass_spec)
    rows, worst = [], None
    for x in p.panels:
        chk = check_plate(spec, x.width_mm, x.height_mm, w["design_pressure_kpa"])
        row = {"tag": x.tag, "width_mm": x.width_mm, "height_mm": x.height_mm, "quantity": x.quantity, **chk}
        rows.append(row)
        if worst is None or chk["utilisation"] > worst["utilisation"]:
            worst = row
    all_safe = all(r["pass"] for r in rows)
    # Project-wide recommendation must satisfy the governing (largest) pane.
    rec_t = rec_l = None
    for fam in ("toughened", "laminated"):
        pool = []
        for x in p.panels:
            r = recommend(x.width_mm, x.height_mm, w["design_pressure_kpa"], fam)
            pool.append(r)
        if all(pool):
            from .engines.glass import CANDIDATES_LAMINATED, CANDIDATES_TOUGHENED
            order = CANDIDATES_TOUGHENED if fam == "toughened" else CANDIDATES_LAMINATED
            key = max((r["glass_spec"] for r in pool), key=order.index)
            if fam == "toughened":
                rec_t = key
            else:
                rec_l = key
    result = {**w, "glass_spec": spec.key, "glass_label": spec.label, "panels": rows,
              "all_safe": all_safe, "governing_panel": worst["tag"], "max_utilisation": worst["utilisation"],
              "failing_panels": [r["tag"] for r in rows if not r["pass"]],
              "min_safe_toughened": rec_t, "min_safe_laminated": rec_l,
              "recommended_glass_spec": None if all_safe else (rec_t or rec_l)}
    _invalidate(p, "wind")
    release_offcuts(db, p.id)
    p.wind = result
    if all_safe:
        p.silicone = run_silicone_calc(p, w["design_pressure_kpa"], pricing.get_prices(db, p.organization_id))
        p.status = "validated"
    db.commit()
    return result


def run_silicone_calc(p: Project, pressure_kpa: float, prices: dict | None = None) -> dict:
    short_span = max(min(x.width_mm, x.height_mm) for x in p.panels)
    perimeter = sum(2 * (x.width_mm + x.height_mm) * x.quantity for x in p.panels) / 1000
    res = silicone.calculate_structural_silicone(pressure_kpa, short_span, perimeter, p.sealant_grade, 1,
                                                sealant_prices=(prices or {}).get("sealants"))
    res["governing_short_span_mm"] = short_span
    res["total_perimeter_m"] = round(perimeter, 2)
    res["panel_count"] = sum(x.quantity for x in p.panels)
    return res


def available_offcuts(db: Session, spec: str, project_id: str | None = None, org: str = DEFAULT_ORG) -> list[Offcut]:
    q = select(Offcut).where(Offcut.organization_id == org, Offcut.glass_spec == spec)
    rows = db.scalars(q).all()
    return [o for o in rows if o.status == "available" or (project_id and o.reserved_for == project_id)]


def release_offcuts(db: Session, project_id: str):
    for o in db.scalars(select(Offcut).where(Offcut.reserved_for == project_id)).all():
        o.status, o.reserved_for = "available", None


def run_cutting(db: Session, p: Project, check_offcuts: bool = True, force: bool = False) -> dict:
    if not p.wind:
        raise ValueError("Run the IS 875 wind-load check before optimizing (safety gate).")
    if not p.wind.get("all_safe") and not force:
        raise ValueError("Glass specification failed the wind-load check. Switch to "
                         f"{p.wind.get('recommended_glass_spec') or 'a thicker spec'} before optimizing.")
    spec_key = parse_glass_spec(p.glass_spec).key
    offs = available_offcuts(db, spec_key, p.id) if check_offcuts else []
    panels = [{"tag": x.tag, "width_mm": x.width_mm, "height_mm": x.height_mm, "quantity": x.quantity,
               "glass_spec": spec_key} for x in p.panels]
    res = cutting.optimize(panels, [{"id": o.id, "width_mm": o.width_mm, "height_mm": o.height_mm,
                                     "glass_spec": o.glass_spec} for o in offs], check_offcuts)
    release_offcuts(db, p.id)
    used = {s["offcut_id"] for g in res["groups"] for s in g["sheets"] if s["source"] == "offcut"}
    for o in offs:
        if str(o.id) in used:
            o.status, o.reserved_for = "reserved", p.id
    _invalidate(p, "cutting")
    p.cutting = res
    p.status = "optimized"
    db.commit()
    return res


def run_quote(db: Session, p: Project, margin_percent: float) -> dict:
    if not p.cutting:
        raise ValueError("Optimize the cutting plan before generating a quote.")
    panels = [{"width_mm": x.width_mm, "height_mm": x.height_mm, "quantity": x.quantity,
               "glass_spec": p.glass_spec} for x in p.panels]
    prices = pricing.get_prices(db, p.organization_id)
    bom = costing.build_bom(panels, p.cutting, p.silicone, prices)
    q = costing.build_quote(bom, margin_percent, prices["commercial"]["gst_pct"])
    q["priced_at"] = pricing.prices_updated_at(db, p.organization_id)
    p.bom, p.quote = bom, q
    p.status = "quoted"
    db.commit()
    pdf_path = render_quote_pdf(p)
    q = {**q, "pdf_url": f"/api/v1/projects/{p.id}/quote.pdf", "pdf_file": str(pdf_path)}
    p.quote = q
    db.commit()
    return q


def render_quote_pdf(p: Project) -> Path:
    from .pdf import quote_pdf
    STORAGE.mkdir(parents=True, exist_ok=True)
    path = STORAGE / f"quote_{p.id}.pdf"
    path.write_bytes(quote_pdf(serialize_project(p)))
    return path


def find_panel_by_uid(db: Session, uid: str, org: str = DEFAULT_ORG) -> tuple[Project, Panel, str] | None:
    """Resolve foreman panel IDs like 'W1-03' or 'W1' to a project panel."""
    needle = uid.strip().upper()
    projects = db.scalars(select(Project).where(Project.organization_id == org)
                          .order_by(Project.updated_at.desc())).all()
    for p in projects:
        for x in p.panels:
            tag = x.tag.upper()
            if needle == tag or (needle.startswith(tag + "-") and needle[len(tag) + 1:].isdigit()):
                return p, x, needle
    return None
