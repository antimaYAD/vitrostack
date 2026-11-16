"""VitroCore copilot: chat sessions, human-in-the-loop actions and tool logs."""
from __future__ import annotations

from fastapi import Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import auth
from ..agent import orchestrator
from ..agent.tools import TOOLS
from ..db import AgentSession, AgentToolLog, User, get_db
from ..uploads import read_upload
from .deps import org_id, protected_router

router = protected_router()


class ChatIn(BaseModel):
    message: str = ""
    session_id: str | None = None
    attachments: list[str] = []


class ActionIn(BaseModel):
    approve: bool
    overrides: dict | None = None


def _session(db, sid, org, user: User) -> AgentSession:
    s = db.get(AgentSession, sid)
    if not s or s.organization_id != org or s.user_id != user.id:
        raise HTTPException(404, "Conversation not found")
    return s


@router.get("/agent/sessions")
def agent_sessions(db: Session = Depends(get_db), org: str = Depends(org_id), user: User = Depends(auth.current_user)):
    rows = db.scalars(select(AgentSession).where(AgentSession.organization_id == org, AgentSession.channel == "web",
                                                 AgentSession.user_id == user.id)
                      .order_by(AgentSession.updated_at.desc()).limit(50)).all()
    return [{"id": s.id, "title": s.title, "project_id": s.project_id, "updated_at": s.updated_at.isoformat()} for s in rows]


@router.get("/agent/sessions/{sid}")
def agent_session(sid: str, db: Session = Depends(get_db), org: str = Depends(org_id), user: User = Depends(auth.current_user)):
    s = _session(db, sid, org, user)
    return {"id": s.id, "title": s.title, "project_id": s.project_id, "messages": orchestrator.history(db, s.id)}


@router.delete("/agent/sessions/{sid}", status_code=204)
def delete_session(sid: str, db: Session = Depends(get_db), org: str = Depends(org_id), user: User = Depends(auth.current_user)):
    s = _session(db, sid, org, user)
    db.delete(s)
    db.commit()


@router.post("/agent/chat")
def agent_chat(body: ChatIn, db: Session = Depends(get_db), org: str = Depends(org_id), user: User = Depends(auth.current_user)):
    if not body.message.strip() and not body.attachments:
        raise ValueError("Type a message or attach a schedule")
    s = _session(db, body.session_id, org, user) if body.session_id else None
    if not s:
        s = AgentSession(organization_id=org, user_id=user.id)
        db.add(s)
        db.commit()
    for a in body.attachments:
        read_upload(a)  # validate it exists
    msg = orchestrator.chat(db, s, body.message.strip(), body.attachments, {"org": org})
    return {"session_id": s.id, "title": s.title, "project_id": s.project_id, "message": msg}


@router.post("/agent/sessions/{sid}/actions/{action_id}")
def agent_action(sid: str, action_id: str, body: ActionIn, db: Session = Depends(get_db), org: str = Depends(org_id),
                 user: User = Depends(auth.current_user)):
    s = _session(db, sid, org, user)
    msg = orchestrator.resolve_action(db, s, action_id, body.approve, body.overrides, {"org": org})
    return {"session_id": s.id, "project_id": s.project_id, "message": msg}


@router.get("/agent/tools")
def agent_tools():
    return [{"name": t.name, "title": t.title, "description": t.description, "parameters": t.parameters,
             "requires_confirmation": t.requires_confirmation} for t in TOOLS.values()]


@router.get("/agent/tool-logs")
def tool_logs(limit: int = Query(50, le=200), db: Session = Depends(get_db), org: str = Depends(org_id)):
    rows = db.scalars(select(AgentToolLog).where(AgentToolLog.organization_id == org)
                      .order_by(AgentToolLog.id.desc()).limit(limit)).all()
    return [{"id": l.id, "tool": l.tool, "args": l.args, "ok": l.ok, "duration_ms": l.duration_ms,
             "session_id": l.session_id, "created_at": l.created_at.isoformat()} for l in rows]
