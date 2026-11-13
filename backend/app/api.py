from __future__ import annotations

from fastapi import APIRouter, Depends, File, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse, PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import auth, pricing, services, whatsapp
from .agent import orchestrator
from .agent.tools import TOOLS
from .db import DEFAULT_ORG, User, AgentSession, AgentToolLog, Alert, Offcut, Project, SiteEvent, get_db
from .engines import cutting, schedule_parser, silicone, wind
from .engines.glass import parse_glass_spec
from .engines.rates import PRICE_SCHEMA, catalogue, defaults, glass_rate
from .uploads import read_upload, save_upload

# Everything on `router` requires a signed-in user; `public` holds health + the WhatsApp webhook.
router = APIRouter(prefix="/api/v1", dependencies=[Depends(auth.current_user)])
public = APIRouter(prefix="/api/v1")


def org_id(user: User = Depends(auth.current_user)) -> str:
    """Tenant scoping comes from the signed-in user, never from a client-supplied header."""
    return user.organization_id


# ------------------------------------------------------------------ schemas

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


class WindIn(BaseModel):
    city: str
    building_height_m: float = Field(gt=0, le=500)
    window_width_mm: int = Field(gt=0, le=6000)
    window_height_mm: int = Field(gt=0, le=6000)
    glass_spec: str
    terrain: int = Field(default=3, ge=1, le=4)
    zone: str = "typical"


class SiliconeIn(BaseModel):
    wind_pressure_kpa: float = Field(gt=0, le=20)
    short_span_mm: int = Field(gt=0, le=6000)
    perimeter_m: float = Field(gt=0)
    sealant_grade: str = "dowsil_995"
    panel_count: int = Field(default=1, gt=0)


class CuttingIn(BaseModel):
    panels: list[PanelIn]
    glass_spec: str = "12mm_toughened"
    check_offcuts: bool = True
    allow_rotate: bool = True


class OffcutIn(BaseModel):
    glass_spec: str
    width_mm: int = Field(gt=0, le=3660)
    height_mm: int = Field(gt=0, le=3660)
    rack: str | None = None
    source: str | None = None
    quantity: int = Field(default=1, ge=1, le=100)


class ChatIn(BaseModel):
    message: str = ""
    session_id: str | None = None
    attachments: list[str] = []


class ActionIn(BaseModel):
    approve: bool
    overrides: dict | None = None


class SimIn(BaseModel):
    phone: str = "+919800000001"
    text: str = Field(min_length=1, max_length=1000)


class MarginIn(BaseModel):
    margin_percent: float = Field(ge=0, lt=90)


class OptimizeIn(BaseModel):
    check_offcuts: bool = True


# ------------------------------------------------------------------ meta

@public.get("/health")
def health():
    return {"status": "ok", "agent_engine": orchestrator.engine_name(), "whatsapp": "live" if whatsapp.is_live() else "simulated"}


@router.get("/reference")
def reference(db: Session = Depends(get_db), org: str = Depends(org_id)):
    prices = pricing.get_prices(db, org)
    return {
        "cities": sorted({k.title(): v for k, v in wind.BASIC_WIND_SPEED.items()}.items()),
        "glass": catalogue(prices),
        "default_margin_pct": prices["commercial"]["default_margin_pct"],
        "gst_pct": prices["commercial"]["gst_pct"],
        "prices_updated_at": pricing.prices_updated_at(db, org),
        "terrain": wind.TERRAIN_LABELS,
        "zones": {k: v["label"] for k, v in wind.ZONES.items()},
        "sealants": silicone.SEALANTS,
        "jumbo_mm": [cutting.JUMBO_W, cutting.JUMBO_H],
        "floor_to_floor_m": wind.FLOOR_TO_FLOOR_M,
    }


@router.get("/dashboard")
def dashboard(db: Session = Depends(get_db), org: str = Depends(org_id)):
    projects = db.scalars(select(Project).where(Project.organization_id == org).order_by(Project.updated_at.desc())).all()
    by_status = {s: 0 for s in services.STATUS_ORDER}
    for p in projects:
        by_status[p.status] = by_status.get(p.status, 0) + 1
    quoted = [p for p in projects if p.quote]
    scraps = [p.cutting["totals"]["scrap_pct"] for p in projects if p.cutting]
    offcuts = db.scalars(select(Offcut).where(Offcut.organization_id == org)).all()
    avail = [o for o in offcuts if o.status == "available"]
    reused_area = sum(o.width_mm * o.height_mm for o in offcuts if o.status in ("reserved", "used")) / 1e6
    saved = 0.0
    prices = pricing.get_prices(db, org)
    for o in offcuts:
        if o.status in ("reserved", "used"):
            try:
                saved += o.width_mm * o.height_mm / 1e6 * glass_rate(parse_glass_spec(o.glass_spec), prices)
            except ValueError:
                pass
    alerts = db.scalars(select(Alert).where(Alert.organization_id == org, Alert.status == "open")
                        .order_by(Alert.id.desc())).all()
    logs = db.scalars(select(AgentToolLog).where(AgentToolLog.organization_id == org)
                      .order_by(AgentToolLog.id.desc()).limit(8)).all()
    unsafe = [p for p in projects if p.wind and not p.wind.get("all_safe")]
    return {
        "kpis": {
            "active_projects": len(projects),
            "pipeline_value": round(sum(p.quote["grand_total"] for p in quoted), 2),
            "quoted_projects": len(quoted),
            "avg_scrap_pct": round(sum(scraps) / len(scraps), 2) if scraps else None,
            "offcuts_available": len(avail),
            "offcut_area_m2": round(sum(o.width_mm * o.height_mm for o in avail) / 1e6, 2),
            "offcut_reused_area_m2": round(reused_area, 2),
            "offcut_savings_inr": round(saved),
            "open_alerts": len(alerts),
            "panels_in_pipeline": sum(sum(x.quantity for x in p.panels) for p in projects),
        },
        "by_status": by_status,
        "recent_projects": [services.serialize_project(p, full=False) for p in projects[:6]],
        "attention": [{"project_id": p.id, "name": p.name, "kind": "unsafe",
                       "message": f"{p.wind.get('glass_label')} fails IS 875 – switch to "
                       f"{parse_glass_spec(p.wind['recommended_glass_spec']).label if p.wind.get('recommended_glass_spec') else 'a thicker spec'}"} for p in unsafe[:5]]
                     + [{"project_id": a.project_id, "name": a.title, "kind": a.kind, "alert_id": a.id,
                         "message": a.body} for a in alerts[:5]],
        "recent_tool_calls": [{"tool": l.tool, "ok": l.ok, "duration_ms": l.duration_ms,
                               "created_at": l.created_at.isoformat()} for l in logs],
        "agent_engine": orchestrator.engine_name(),
    }


# ------------------------------------------------------------------ projects

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
    from .engines import costing
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


# ------------------------------------------------------------------ engineering tools

@router.post("/engineering/wind")
def eng_wind(body: WindIn):
    return wind.calculate_is875_wind_load(**body.model_dump())


@router.post("/engineering/silicone")
def eng_silicone(body: SiliconeIn, db: Session = Depends(get_db), org: str = Depends(org_id)):
    return silicone.calculate_structural_silicone(**body.model_dump(), sealant_prices=pricing.get_prices(db, org)["sealants"])


@router.post("/engineering/cutting")
def eng_cutting(body: CuttingIn, db: Session = Depends(get_db), org: str = Depends(org_id)):
    spec = parse_glass_spec(body.glass_spec).key
    offs = services.available_offcuts(db, spec, None, org) if body.check_offcuts else []
    panels = [{**x.model_dump(), "glass_spec": spec} for x in body.panels]
    return cutting.optimize(panels, [{"id": o.id, "width_mm": o.width_mm, "height_mm": o.height_mm,
                                      "glass_spec": o.glass_spec} for o in offs], body.check_offcuts, body.allow_rotate)


@router.post("/uploads")
async def upload(file: UploadFile = File(...)):
    content = await file.read()
    file_id = save_upload(file.filename or "schedule.csv", content)
    try:
        preview = schedule_parser.parse_file(file.filename or "", content)
    except ValueError as e:
        preview = {"error": str(e)}
    return {"file_id": file_id, "filename": file.filename, "size": len(content), "preview": preview}


# ------------------------------------------------------------------ offcuts

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


@router.post("/offcuts", status_code=201)
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


# ------------------------------------------------------------------ agent

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


# ------------------------------------------------------------------ whatsapp & alerts

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


@router.post("/whatsapp/simulate")
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


# ------------------------------------------------------------------ admin: price list

class PricesIn(BaseModel):
    prices: dict[str, dict[str, float]]


@router.get("/admin/prices", dependencies=[Depends(auth.require_admin)])
def admin_prices(db: Session = Depends(get_db), org: str = Depends(org_id)):
    from .engines.glass import parse_glass_spec as _p
    schema = {k: {**v, "items": {ik: dict(iv) for ik, iv in v["items"].items()}} for k, v in PRICE_SCHEMA.items()}
    for key, item in schema["glass"]["items"].items():
        item["label"] = _p(key).label
    return {"prices": pricing.get_prices(db, org), "defaults": defaults(), "schema": schema,
            "updated_at": pricing.prices_updated_at(db, org)}


@router.put("/admin/prices")
def admin_save_prices(body: PricesIn, db: Session = Depends(get_db), org: str = Depends(org_id),
                      admin: User = Depends(auth.require_admin)):
    saved = pricing.save_prices(db, body.prices, org, admin.name)
    return {"prices": saved, "updated_at": pricing.prices_updated_at(db, org)}


@router.get("/admin/prices/history", dependencies=[Depends(auth.require_admin)])
def admin_price_history(db: Session = Depends(get_db), org: str = Depends(org_id)):
    return pricing.history(db, org)
