"""Alerts raised by site ops (e.g. breakage) that need an approve / dismiss decision."""
from __future__ import annotations

from fastapi import Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import whatsapp
from ..db import Alert, get_db
from .deps import org_id, protected_router

router = protected_router()


def _alert(a: Alert) -> dict:
    payload = dict(a.payload or {})
    payload.pop("plan", None)
    return {"id": a.id, "kind": a.kind, "title": a.title, "body": a.body, "status": a.status,
            "project_id": a.project_id, "payload": payload, "created_at": a.created_at.isoformat()}


@router.get("/alerts")
def list_alerts(status: str | None = None, db: Session = Depends(get_db), org: str = Depends(org_id)):
    stmt = select(Alert).where(Alert.organization_id == org)
    if status:
        stmt = stmt.where(Alert.status == status)
    return [_alert(a) for a in db.scalars(stmt.order_by(Alert.id.desc()).limit(100)).all()]


@router.get("/alerts/count")
def alert_count(db: Session = Depends(get_db), org: str = Depends(org_id)):
    n = db.scalar(select(func.count()).select_from(Alert).where(Alert.organization_id == org, Alert.status == "open"))
    return {"open": n or 0}


@router.post("/alerts/{aid}/approve")
def approve_alert(aid: int, db: Session = Depends(get_db), org: str = Depends(org_id)):
    a = db.get(Alert, aid)
    if not a or a.organization_id != org:
        raise HTTPException(404, "Alert not found")
    if a.status != "open":
        raise ValueError(f"Alert already {a.status}")
    if a.kind == "breakage":
        return {**whatsapp.approve_breakage(db, a), "alert": _alert(a)}
    a.status = "approved"
    db.commit()
    return {"status": "approved", "alert": _alert(a)}


@router.post("/alerts/{aid}/dismiss")
def dismiss_alert(aid: int, db: Session = Depends(get_db), org: str = Depends(org_id)):
    a = db.get(Alert, aid)
    if not a or a.organization_id != org:
        raise HTTPException(404, "Alert not found")
    a.status = "dismissed"
    db.commit()
    return {"status": "dismissed", "alert": _alert(a)}
