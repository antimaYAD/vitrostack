"""Offcut (remnant glass) inventory."""
from __future__ import annotations

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import auth
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
    quantity: int = Field(default=1, ge=1, le=100)


def _offcut(o: Offcut) -> dict:
    try:
        label = parse_glass_spec(o.glass_spec).label
    except ValueError:
        label = o.glass_spec
    return {"id": o.id, "glass_spec": o.glass_spec, "glass_label": label, "width_mm": o.width_mm,
            "height_mm": o.height_mm, "area_m2": round(o.width_mm * o.height_mm / 1e6, 3), "rack": o.rack,
            "source": o.source, "status": o.status, "reserved_for": o.reserved_for,
            "created_at": o.created_at.isoformat()}


@router.get("/offcuts")
def list_offcuts(db: Session = Depends(get_db), org: str = Depends(org_id)):
    rows = db.scalars(select(Offcut).where(Offcut.organization_id == org).order_by(Offcut.id.desc())).all()
    return [_offcut(o) for o in rows]


@router.post("/offcuts", status_code=201, dependencies=[Depends(auth.require_admin)])
def add_offcut(body: OffcutIn, db: Session = Depends(get_db), org: str = Depends(org_id)):
    spec = parse_glass_spec(body.glass_spec).key
    out = []
    for _ in range(body.quantity):
        o = Offcut(organization_id=org, glass_spec=spec, width_mm=max(body.width_mm, body.height_mm),
                   height_mm=min(body.width_mm, body.height_mm), rack=body.rack, source=body.source or "Manual entry")
        db.add(o)
        out.append(o)
    db.commit()
    return [_offcut(o) for o in out]


@router.delete("/offcuts/{oid}", status_code=204)
def delete_offcut(oid: int, db: Session = Depends(get_db), org: str = Depends(org_id)):
    o = db.get(Offcut, oid)
    if not o or o.organization_id != org:
        raise HTTPException(404, "Offcut not found")
    if o.status == "reserved":
        raise ValueError("This offcut is reserved by a cutting plan. Re-optimize that project first.")
    db.delete(o)
    db.commit()
