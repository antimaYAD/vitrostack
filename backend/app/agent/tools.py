"""Tool registry exposed to the VitroCore agent (function calling).

Every engineering number comes from these deterministic engines – never from the LLM.
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any, Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import pricing, services, whatsapp
from ..db import DEFAULT_ORG, AgentToolLog, Offcut, Project
from ..engines import schedule_parser, silicone, wind
from ..uploads import read_upload


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict
    fn: Callable[[Session, dict, dict], dict]
    requires_confirmation: bool = False
    title: str = ""


def _project_brief(p: Project) -> dict:
    d = services.serialize_project(p, full=False)
    return {k: d[k] for k in ("id", "name", "city", "building_height_m", "glass_spec", "status",
                              "panel_count", "panel_area_m2", "all_safe", "design_pressure_kpa",
                              "scrap_pct", "jumbo_sheets", "grand_total")}


# ---------- tool implementations ----------

def t_parse_schedule(db, a, ctx):
    name, content = read_upload(a["file_url"])
    res = schedule_parser.parse_file(name, content)
    return {"file": name, **res}


def t_wind(db, a, ctx):
    return wind.calculate_is875_wind_load(
        a["city"], float(a["building_height_m"]), int(a["window_width_mm"]), int(a["window_height_mm"]),
        a["glass_spec"], int(a.get("terrain") or 3), a.get("zone") or "typical")


def t_silicone(db, a, ctx):
    return silicone.calculate_structural_silicone(
        float(a["wind_pressure_kpa"]), int(a["short_span_mm"]), float(a["perimeter_m"]),
        a.get("sealant_grade") or "dowsil_995", int(a.get("panel_count") or 1),
        sealant_prices=pricing.get_prices(db, ctx.get("org", DEFAULT_ORG))["sealants"])


def t_create_project(db, a, ctx):
    p = services.create_project(db, a, ctx.get("org", DEFAULT_ORG))
    services.run_wind_check(db, p)
    db.refresh(p)
    return {"project": _project_brief(p), "wind": {k: p.wind[k] for k in (
        "design_pressure_kpa", "all_safe", "max_utilisation", "governing_panel", "failing_panels",
        "recommended_glass_spec")}, "silicone": p.silicone}


def t_update_spec(db, a, ctx):
    p = services.get_project(db, a["project_id"], ctx.get("org", DEFAULT_ORG))
    services.update_project(db, p, {"glass_spec": a["glass_spec"]})
    services.run_wind_check(db, p)
    db.refresh(p)
    return {"project": _project_brief(p), "wind": {k: p.wind[k] for k in (
        "design_pressure_kpa", "all_safe", "max_utilisation", "governing_panel", "failing_panels",
        "recommended_glass_spec")}, "silicone": p.silicone}


def t_optimize(db, a, ctx):
    p = services.get_project(db, a["project_id"], ctx.get("org", DEFAULT_ORG))
    res = services.run_cutting(db, p, bool(a.get("check_offcuts", True)))
    return {"project_id": p.id, "task_id": f"cut_{p.id}_{int(time.time())}", "status": "SUCCESS",
            **res["totals"], "heuristic": [g["heuristic"] for g in res["groups"]],
            "svg_layout_url": f"/projects/{p.id}?tab=cutting"}


def t_quote(db, a, ctx):
    p = services.get_project(db, a["project_id"], ctx.get("org", DEFAULT_ORG))
    margin = a.get("margin_percent")
    if margin is None:
        margin = pricing.get_prices(db, ctx.get("org", DEFAULT_ORG))["commercial"]["default_margin_pct"]
    q = services.run_quote(db, p, float(margin))
    return {"project_id": p.id, **{k: v for k, v in q.items() if k != "pdf_file"}}


def t_whatsapp(db, a, ctx):
    return whatsapp.send_site_update(db, a["recipient_phone"], a.get("batch_id", ""), a["status"],
                                     a.get("media_url"), ctx.get("org", DEFAULT_ORG))


def t_offcuts(db, a, ctx):
    q = select(Offcut).where(Offcut.organization_id == ctx.get("org", DEFAULT_ORG), Offcut.status == "available")
    if a.get("glass_spec"):
        q = q.where(Offcut.glass_spec == a["glass_spec"])
    rows = services.usable_offcuts(db.scalars(q).all())
    q = services.qty
    return {"count": sum(q(o) for o in rows), "area_m2": round(sum(o.width_mm * o.height_mm * q(o) for o in rows) / 1e6, 2),
            "offcuts": [{"id": o.id, "glass_spec": o.glass_spec, "width_mm": o.width_mm,
                         "height_mm": o.height_mm, "rack": o.rack, "quantity": q(o)} for o in rows[:50]]}


def t_list_projects(db, a, ctx):
    rows = db.scalars(select(Project).where(Project.organization_id == ctx.get("org", DEFAULT_ORG))
                      .order_by(Project.updated_at.desc()).limit(20)).all()
    return {"projects": [_project_brief(p) for p in rows]}


def t_get_project(db, a, ctx):
    p = services.get_project(db, a["project_id"], ctx.get("org", DEFAULT_ORG))
    d = services.serialize_project(p)
    d.pop("cutting", None)
    if d.get("wind"):
        d["wind"] = {k: v for k, v in d["wind"].items() if k != "panels"}
    return d


_PANEL_ITEM = {"type": "object", "properties": {
    "tag": {"type": "string", "description": "Window tag, e.g. W1"},
    "width_mm": {"type": "integer"}, "height_mm": {"type": "integer"},
    "quantity": {"type": "integer"}, "floor_level": {"type": "string"}}, "required": ["width_mm", "height_mm", "quantity"]}

TOOLS: dict[str, Tool] = {t.name: t for t in [
    Tool("parse_window_schedule",
         "Extracts window IDs, widths (mm), heights (mm), quantities and floor levels from an uploaded CSV or Excel window schedule.",
         {"type": "object", "properties": {"file_url": {"type": "string", "description": "Upload ID returned by the file upload endpoint."}},
          "required": ["file_url"]}, t_parse_schedule, title="Parse window schedule"),
    Tool("calculate_is875_wind_load",
         "Calculates design wind pressure under IS 875 (Part 3) and validates whether the glass specification is structurally safe for the pane size.",
         {"type": "object", "properties": {
             "city": {"type": "string", "description": "Indian city of the site, e.g. Mumbai."},
             "building_height_m": {"type": "number", "description": "Installation height above ground in metres."},
             "window_width_mm": {"type": "integer"}, "window_height_mm": {"type": "integer"},
             "glass_spec": {"type": "string", "description": "e.g. '12mm_toughened', '13.52mm_laminated'."},
             "terrain": {"type": "integer", "description": "IS 875 terrain category 1-4 (default 3)."},
             "zone": {"type": "string", "enum": ["typical", "corner"]}},
          "required": ["city", "building_height_m", "window_width_mm", "window_height_mm", "glass_spec"]},
         t_wind, title="IS 875 wind-load check"),
    Tool("calculate_structural_silicone",
         "Returns required structural silicone bite (mm), glueline thickness (mm) and number of 600 ml sausages.",
         {"type": "object", "properties": {
             "wind_pressure_kpa": {"type": "number"}, "short_span_mm": {"type": "integer"},
             "perimeter_m": {"type": "number", "description": "Total bonded perimeter of all panels in metres."},
             "sealant_grade": {"type": "string", "enum": ["dowsil_995", "dowsil_993"]}},
          "required": ["wind_pressure_kpa", "short_span_mm", "perimeter_m"]},
         t_silicone, title="Structural silicone sizing"),
    Tool("create_project",
         "Creates a VitroStack project with its panel schedule and runs the project-wide IS 875 validation and silicone sizing.",
         {"type": "object", "properties": {
             "name": {"type": "string"}, "client": {"type": "string"}, "city": {"type": "string"},
             "building_height_m": {"type": "number"}, "glass_spec": {"type": "string"},
             "glazing_system": {"type": "string", "description": "e.g. butt-joint, unitized, semi-unitized"},
             "terrain": {"type": "integer"}, "zone": {"type": "string", "enum": ["typical", "corner"]},
             "panels": {"type": "array", "items": _PANEL_ITEM}},
          "required": ["name", "city", "building_height_m", "glass_spec", "panels"]},
         t_create_project, title="Create project & validate"),
    Tool("update_project_glass_spec",
         "Changes a project's glass specification and re-runs the IS 875 validation.",
         {"type": "object", "properties": {"project_id": {"type": "string"}, "glass_spec": {"type": "string"}},
          "required": ["project_id", "glass_spec"]}, t_update_spec, title="Update glass specification"),
    Tool("optimize_2d_glass_cutting",
         "Runs the 2D guillotine cutting optimizer for a validated project, reusing factory offcuts first. Returns jumbo sheets, scrap % and layout URL.",
         {"type": "object", "properties": {"project_id": {"type": "string"},
                                           "check_offcuts": {"type": "boolean"}},
          "required": ["project_id"]}, t_optimize, title="2D cutting optimization"),
    Tool("generate_client_quote_pdf",
         "Compiles BOM costs, labour and GST into a branded PDF quotation. Irreversible client-facing action – requires user approval.",
         {"type": "object", "properties": {"project_id": {"type": "string"},
                                           "margin_percent": {"type": "number"}},
          "required": ["project_id", "margin_percent"]}, t_quote, requires_confirmation=True,
         title="Generate client quote PDF"),
    Tool("send_whatsapp_site_update",
         "Sends a WhatsApp status update or label link to a site foreman. Outbound message – requires user approval.",
         {"type": "object", "properties": {"recipient_phone": {"type": "string"}, "batch_id": {"type": "string"},
                                           "status": {"type": "string"}, "media_url": {"type": "string"}},
          "required": ["recipient_phone", "status"]}, t_whatsapp, requires_confirmation=True,
         title="Send WhatsApp update"),
    Tool("list_offcut_inventory", "Lists available factory glass offcuts, optionally filtered by glass spec.",
         {"type": "object", "properties": {"glass_spec": {"type": "string"}}}, t_offcuts, title="Offcut inventory"),
    Tool("list_projects", "Lists recent projects with status and key metrics.",
         {"type": "object", "properties": {}}, t_list_projects, title="List projects"),
    Tool("get_project", "Gets a project's details, validation, BOM and quote.",
         {"type": "object", "properties": {"project_id": {"type": "string"}}, "required": ["project_id"]},
         t_get_project, title="Get project"),
]}


def execute(db: Session, name: str, args: dict, ctx: dict) -> dict:
    """Run a tool, log it to agent_tool_logs and return a UI step record."""
    tool = TOOLS.get(name)
    started = time.perf_counter()
    ok, result = True, None
    try:
        if not tool:
            raise ValueError(f"Unknown tool {name}")
        result = tool.fn(db, args, ctx)
    except Exception as e:  # tool errors are returned to the agent, never raised to the user
        db.rollback()
        ok, result = False, {"error": str(e)}
    ms = int((time.perf_counter() - started) * 1000)
    db.add(AgentToolLog(organization_id=ctx.get("org", DEFAULT_ORG), session_id=ctx.get("session_id"),
                        tool=name, args=args, result=_compact(result), ok=ok, duration_ms=ms))
    db.commit()
    return {"tool": name, "title": tool.title if tool else name, "args": args, "ok": ok,
            "result": result, "duration_ms": ms}


def _compact(obj: Any, depth: int = 0) -> Any:
    """Keep tool logs small (cutting layouts can be large)."""
    if depth > 3:
        return "…"
    if isinstance(obj, dict):
        return {k: _compact(v, depth + 1) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_compact(v, depth + 1) for v in obj[:20]]
    return obj
