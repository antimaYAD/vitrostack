"""Saved designs: window designer elevations and facade studio elevations (data.kind == "facade")."""
from __future__ import annotations

import json
from typing import Literal

from fastapi import Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import auth
from ..db import Project, User, WindowDesign, get_db
from .deps import org_id, protected_router

router = protected_router()

MAX_DESIGN_BYTES = 200_000


class DesignIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    project_id: str | None = None
    data: dict
    summary: dict | None = None


def _check(body: DesignIn, db: Session, org: str):
    if len(json.dumps(body.data)) > MAX_DESIGN_BYTES:
        raise ValueError("Design is too large to save")
    if body.data.get("kind") == "facade":
        if not isinstance(body.data.get("bays"), list) or not body.data["bays"]:
            raise ValueError("Facade has no bays")
    elif not isinstance(body.data.get("root"), dict):
        raise ValueError("Design has no layout")
    if body.project_id:
        p = db.get(Project, body.project_id)
        if not p or p.organization_id != org:
            raise ValueError("Project not found")


def _get(db: Session, did: str, org: str) -> WindowDesign:
    d = db.get(WindowDesign, did)
    if not d or d.organization_id != org:
        raise HTTPException(404, "Design not found")
    return d


def _out(d: WindowDesign, project_names: dict[str, str] | None = None) -> dict:
    return {"id": d.id, "name": d.name, "project_id": d.project_id,
            "project_name": (project_names or {}).get(d.project_id) if d.project_id else None,
            "data": d.data, "summary": d.summary, "created_by": d.created_by,
            "created_at": d.created_at.isoformat(), "updated_at": d.updated_at.isoformat()}


@router.get("/designs")
def list_designs(project_id: str | None = None, kind: Literal["window", "facade", "all"] = "window",
                 db: Session = Depends(get_db), org: str = Depends(org_id)):
    stmt = select(WindowDesign).where(WindowDesign.organization_id == org)
    if project_id:
        stmt = stmt.where(WindowDesign.project_id == project_id)
    rows = db.scalars(stmt.order_by(WindowDesign.updated_at.desc()).limit(500)).all()
    if kind != "all":
        rows = [d for d in rows if ((d.data or {}).get("kind") == "facade") == (kind == "facade")][:200]
    names = dict(db.execute(select(Project.id, Project.name).where(Project.organization_id == org)).all())
    return [_out(d, names) for d in rows]


@router.post("/designs", status_code=201)
def create_design(body: DesignIn, db: Session = Depends(get_db), org: str = Depends(org_id),
                  user: User = Depends(auth.current_user)):
    _check(body, db, org)
    d = WindowDesign(organization_id=org, name=body.name.strip(), project_id=body.project_id or None,
                     data=body.data, summary=body.summary, created_by=user.name)
    db.add(d)
    db.commit()
    return _out(d)


@router.get("/designs/{did}")
def get_design(did: str, db: Session = Depends(get_db), org: str = Depends(org_id)):
    return _out(_get(db, did, org))


@router.put("/designs/{did}")
def update_design(did: str, body: DesignIn, db: Session = Depends(get_db), org: str = Depends(org_id)):
    d = _get(db, did, org)
    _check(body, db, org)
    d.name, d.project_id, d.data, d.summary = body.name.strip(), body.project_id or None, body.data, body.summary
    db.commit()
    return _out(d)


@router.delete("/designs/{did}", status_code=204)
def delete_design(did: str, db: Session = Depends(get_db), org: str = Depends(org_id)):
    db.delete(_get(db, did, org))
    db.commit()
