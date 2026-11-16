"""Projects: CRUD, wind validation, cutting optimisation, quotes and remnants."""
from __future__ import annotations

from fastapi import Depends, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import auth, pricing, services
from ..db import Offcut, Project, get_db
from ..engines import costing
from .deps import org_id, protected_router

router = protected_router()


class PanelIn(BaseModel):
    tag: str | None = None
    width_mm: int = Field(gt=0, le=6000)
    height_mm: int = Field(gt=0, le=6000)
    quantity: int = Field(default=1, gt=0, le=10000)
    floor_level: str | None = None
    notes: str | None = None
    needs_review: bool = False


class ProjectIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    client: str | None = None
    city: str
    building_height_m: float = Field(gt=0, le=500)
    terrain: int = Field(default=3, ge=1, le=4)
    zone: str = "typical"
    glass_spec: str = "12mm_toughened"
    sealant_grade: str = "dowsil_995"
    glazing_system: str | None = None
    panels: list[PanelIn] = []


class ProjectPatch(BaseModel):
    name: str | None = None
    client: str | None = None
    city: str | None = None
    building_height_m: float | None = Field(default=None, gt=0, le=500)
    terrain: int | None = Field(default=None, ge=1, le=4)
    zone: str | None = None
    glass_spec: str | None = None
    sealant_grade: str | None = None
    glazing_system: str | None = None
    panels: list[PanelIn] | None = None


class MarginIn(BaseModel):
    margin_percent: float = Field(ge=0, lt=90)


class OptimizeIn(BaseModel):
    check_offcuts: bool = True


@router.get("/projects")
def list_projects(q: str | None = None, status: str | None = None, db: Session = Depends(get_db),
                  org: str = Depends(org_id)):
    stmt = select(Project).where(Project.organization_id == org).order_by(Project.updated_at.desc())
    rows = db.scalars(stmt).all()
    out = [services.serialize_project(p, full=False) for p in rows]
    if q:
        ql = q.lower()
        out = [p for p in out if ql in p["name"].lower() or ql in (p["client"] or "").lower() or ql in p["city"].lower()]
    if status:
        out = [p for p in out if p["status"] == status]
    return out


@router.post("/projects", status_code=201)
def create_project(body: ProjectIn, db: Session = Depends(get_db), org: str = Depends(org_id)):
    p = services.create_project(db, body.model_dump(), org)
    return services.serialize_project(p)


@router.get("/projects/{pid}")
def get_project(pid: str, db: Session = Depends(get_db), org: str = Depends(org_id)):
    return services.serialize_project(services.get_project(db, pid, org))


@router.patch("/projects/{pid}")
def patch_project(pid: str, body: ProjectPatch, db: Session = Depends(get_db), org: str = Depends(org_id)):
    p = services.get_project(db, pid, org)
    data = body.model_dump(exclude_unset=True)
    if "panels" in data and data["panels"] is not None:
        data["panels"] = [x for x in data["panels"]]
    return services.serialize_project(services.update_project(db, p, data))


@router.delete("/projects/{pid}", status_code=204, dependencies=[Depends(auth.require_admin)])
def delete_project(pid: str, db: Session = Depends(get_db), org: str = Depends(org_id)):
    p = services.get_project(db, pid, org)
    services.release_offcuts(db, pid)
    db.delete(p)
    db.commit()


@router.post("/projects/{pid}/validate")
def validate_project(pid: str, db: Session = Depends(get_db), org: str = Depends(org_id)):
    p = services.get_project(db, pid, org)
    services.run_wind_check(db, p)
    return services.serialize_project(p)


@router.post("/projects/{pid}/apply-recommendation")
def apply_recommendation(pid: str, db: Session = Depends(get_db), org: str = Depends(org_id)):
    p = services.get_project(db, pid, org)
    rec = (p.wind or {}).get("recommended_glass_spec")
    if not rec:
        raise ValueError("No recommendation to apply – the current spec already passes or has not been checked.")
    services.update_project(db, p, {"glass_spec": rec})
    services.run_wind_check(db, p)
    return services.serialize_project(p)


@router.post("/projects/{pid}/optimize")
def optimize_project(pid: str, body: OptimizeIn, db: Session = Depends(get_db), org: str = Depends(org_id)):
    p = services.get_project(db, pid, org)
    services.run_cutting(db, p, body.check_offcuts)
    return services.serialize_project(p)


@router.post("/projects/{pid}/quote")
def quote_project(pid: str, body: MarginIn, db: Session = Depends(get_db), org: str = Depends(org_id)):
    p = services.get_project(db, pid, org)
    services.run_quote(db, p, body.margin_percent)
    return services.serialize_project(p)


@router.get("/projects/{pid}/quote-preview")
def quote_preview(pid: str, margin_percent: float = Query(18, ge=0, lt=90), db: Session = Depends(get_db),
                  org: str = Depends(org_id)):
    """Live margin preview without persisting (for the approval slider)."""
    p = services.get_project(db, pid, org)
    if not p.cutting:
        raise ValueError("Optimize cutting first")
    panels = [{"width_mm": x.width_mm, "height_mm": x.height_mm, "quantity": x.quantity, "glass_spec": p.glass_spec} for x in p.panels]
    prices = pricing.get_prices(db, org)
    bom = costing.build_bom(panels, p.cutting, p.silicone, prices)
    return {"bom": bom, "quote": costing.build_quote(bom, margin_percent, prices["commercial"]["gst_pct"])}


@router.get("/projects/{pid}/quote.pdf")
def quote_pdf(pid: str, db: Session = Depends(get_db), org: str = Depends(org_id)):
    p = services.get_project(db, pid, org)
    if not p.quote:
        raise HTTPException(404, "No quote generated yet")
    path = services.STORAGE / f"quote_{p.id}.pdf"
    if not path.exists():
        path = services.render_quote_pdf(p)
    safe = "".join(c if c.isalnum() else "_" for c in p.name)[:40]
    return FileResponse(path, media_type="application/pdf", filename=f"VitroStack_Quote_{safe}.pdf")


@router.post("/projects/{pid}/remnants")
def save_remnants(pid: str, db: Session = Depends(get_db), org: str = Depends(org_id)):
    p = services.get_project(db, pid, org)
    if not p.cutting:
        raise ValueError("No cutting plan yet")
    if p.cutting.get("remnants_saved"):
        raise ValueError("Remnants from this plan were already added to inventory")
    n = 0
    for g in p.cutting["groups"]:
        for s in g["sheets"]:
            for r in s["remnants"]:
                db.add(Offcut(organization_id=org, glass_spec=g["glass_spec"], width_mm=r["w"], height_mm=r["h"],
                              source=f"{p.name} · sheet {s['index']}", rack="R-NEW"))
                n += 1
    p.cutting = {**p.cutting, "remnants_saved": True}
    db.commit()
    return {"added": n}
