"""Offcut (remnant glass) inventory. Each row is one size of glass on one rack, with a stored quantity."""
from __future__ import annotations

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import auth, services
from ..db import Offcut, get_db
from ..engines.glass import parse_glass_spec
from .deps import org_id, protected_router

router = protected_router()


class OffcutIn(BaseModel):
    glass_spec: str
    width_mm: int = Field(gt=0, le=3660)
    height_mm: int = Field(gt=0, le=3660)
    rack: str | None = None
    source: str | None = None
    quantity: int = Field(default=1, ge=1, le=500)


def _offcut(o: Offcut, counts: dict[tuple, int]) -> dict:
    try:
        label = parse_glass_spec(o.glass_spec).label
    except ValueError:
        label = o.glass_spec
    q = services.qty(o)
    available = counts.get(services.offcut_group(o), 0)
    return {"id": o.id, "glass_spec": o.glass_spec, "glass_label": label, "width_mm": o.width_mm,
            "height_mm": o.height_mm, "quantity": q, "area_m2": round(o.width_mm * o.height_mm / 1e6, 3),
            "total_area_m2": round(o.width_mm * o.height_mm * q / 1e6, 3), "rack": o.rack,
            "source": o.source, "status": o.status, "reserved_for": o.reserved_for,
            "created_at": o.created_at.isoformat(), "available_count": available,
            "usable": o.status == "available" and available > services.MIN_UNAVAILABLE_COUNT}


def _org_counts(db: Session, org: str) -> dict[tuple, int]:
    return services.offcut_counts(db.scalars(select(Offcut).where(Offcut.organization_id == org)).all())


@router.get("/offcuts")
def list_offcuts(db: Session = Depends(get_db), org: str = Depends(org_id)):
    rows = db.scalars(select(Offcut).where(Offcut.organization_id == org).order_by(Offcut.id.desc())).all()
    counts = services.offcut_counts(rows)
    return [_offcut(o, counts) for o in rows]


@router.post("/offcuts", status_code=201, dependencies=[Depends(auth.require_admin)])
def add_offcut(body: OffcutIn, db: Session = Depends(get_db), org: str = Depends(org_id)):
    """Adds to the quantity of the matching available row (same glass, size, rack) or creates a new row."""
    spec = parse_glass_spec(body.glass_spec).key
    o = services.add_offcut_stock(db, org, spec, body.width_mm, body.height_mm, body.rack, body.source, body.quantity)
    db.commit()
    return _offcut(o, _org_counts(db, org))


class OffcutCountIn(BaseModel):
    count: int = Field(ge=0, le=10000)


@router.put("/offcuts/{oid}/count", dependencies=[Depends(auth.require_admin)])
def set_offcut_count(oid: int, body: OffcutCountIn, db: Session = Depends(get_db), org: str = Depends(org_id)):
    """Set the stored quantity of an available offcut row."""
    o = db.get(Offcut, oid)
    if not o or o.organization_id != org:
        raise HTTPException(404, "Offcut not found")
    if o.status != "available":
        raise ValueError("Only available stock can be recounted. Re-optimize the project holding these pieces first.")
    o.quantity = body.count
    db.commit()
    return _offcut(o, _org_counts(db, org))


@router.delete("/offcuts/{oid}", status_code=204)
def delete_offcut(oid: int, db: Session = Depends(get_db), org: str = Depends(org_id)):
    o = db.get(Offcut, oid)
    if not o or o.organization_id != org:
        raise HTTPException(404, "Offcut not found")
    if o.status == "reserved":
        raise ValueError("This offcut is reserved by a cutting plan. Re-optimize that project first.")
    db.delete(o)
    db.commit()
