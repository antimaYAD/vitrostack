"""Health check, reference data for the UI, and the overview dashboard."""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import pricing, services, whatsapp
from ..agent import orchestrator
from ..db import AgentToolLog, Alert, Offcut, Project, get_db
from ..engines import cutting, silicone, wind
from ..engines.glass import parse_glass_spec
from ..engines.rates import catalogue, glass_rate
from .deps import org_id, protected_router

public = APIRouter(prefix="/api/v1")
router = protected_router()


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
