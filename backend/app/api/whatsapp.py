"""WhatsApp site-ops: Meta webhook (public), simulator and message log."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import whatsapp
from ..db import SiteEvent, get_db
from .deps import editor, org_id, protected_router

public = APIRouter(prefix="/api/v1")  # Meta calls the webhook without a session
router = protected_router()


class SimIn(BaseModel):
    phone: str = "+919800000001"
    text: str = Field(min_length=1, max_length=1000)


@public.get("/whatsapp/webhook", response_class=PlainTextResponse)
def wa_verify(request: Request):
    q = request.query_params
    if q.get("hub.mode") == "subscribe" and q.get("hub.verify_token") == whatsapp.VERIFY_TOKEN:
        return q.get("hub.challenge", "")
    raise HTTPException(403, "Verification failed")


@public.post("/whatsapp/webhook")
async def wa_webhook(request: Request, db: Session = Depends(get_db)):
    data = await request.json()
    handled = []
    for entry in data.get("entry", []):
        for change in entry.get("changes", []):
            for m in change.get("value", {}).get("messages", []):
                text = (m.get("text") or {}).get("body") or (m.get("image") or {}).get("caption") or ""
                if text:
                    handled.append(whatsapp.handle_incoming(db, "+" + m.get("from", ""), text))
    return {"handled": len(handled)}


@router.post("/whatsapp/simulate", dependencies=[editor])
def wa_simulate(body: SimIn, db: Session = Depends(get_db), org: str = Depends(org_id)):
    return whatsapp.handle_incoming(db, body.phone, body.text, org)


@router.get("/whatsapp/events")
def wa_events(phone: str | None = None, db: Session = Depends(get_db), org: str = Depends(org_id)):
    stmt = select(SiteEvent).where(SiteEvent.organization_id == org)
    if phone:
        stmt = stmt.where(SiteEvent.phone == phone)
    rows = db.scalars(stmt.order_by(SiteEvent.id.desc()).limit(200)).all()
    return [{"id": e.id, "phone": e.phone, "direction": e.direction, "text": e.text, "project_id": e.project_id,
             "created_at": e.created_at.isoformat()} for e in reversed(rows)]
