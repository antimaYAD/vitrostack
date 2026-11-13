"""VitroCore orchestration: Gemini function calling when configured, deterministic planner otherwise.

Both engines call the same tool registry, log every call to agent_tool_logs, and route
irreversible actions (quote PDF, WhatsApp) through a human approval step.
"""
from __future__ import annotations

import json
import logging
import os

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from .. import pricing
from ..db import AgentMessage, AgentSession, uid
from ..engines.glass import parse_glass_spec
from . import nlu
from .prompts import SYSTEM_PROMPT
from .tools import TOOLS, execute

log = logging.getLogger("vitrocore")
GEMINI_KEY = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
DEFAULT_SPEC = "12mm_toughened"
DEFAULT_MARGIN = 18.0


def engine_name() -> str:
    return f"gemini:{GEMINI_MODEL}" if GEMINI_KEY else "vitrocore-planner (offline)"


def pct(u: float) -> str:
    v = u * 100
    return f"{v:.1f}%" if 99 <= v < 101 or v < 10 else f"{v:.0f}%"


def inr(v: float) -> str:
    v = round(v)
    s = str(abs(v))
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        parts = []
        while len(head) > 2:
            parts.insert(0, head[-2:])
            head = head[:-2]
        if head:
            parts.insert(0, head)
        s = ",".join(parts + [tail])
    return f"₹{'-' if v < 0 else ''}{s}"


# ---------------------------------------------------------------- session helpers

def _state(session: AgentSession) -> dict:
    st = dict(session.state or {})
    st.setdefault("slots", {})
    st.setdefault("pending", {})
    return st


def _save_state(db: Session, session: AgentSession, st: dict):
    session.state = st
    flag_modified(session, "state")
    db.commit()


def _pending(st: dict, tool: str, args: dict, description: str) -> dict:
    action = {"id": uid(), "tool": tool, "title": TOOLS[tool].title, "args": args, "description": description}
    st["pending"][action["id"]] = action
    return action


def history(db: Session, session_id: str) -> list[dict]:
    rows = db.scalars(select(AgentMessage).where(AgentMessage.session_id == session_id)
                      .order_by(AgentMessage.id)).all()
    return [{"id": m.id, "role": m.role, "content": m.content, **(m.payload or {}),
             "created_at": m.created_at.isoformat()} for m in rows]


def _store(db, session, role, content, payload=None) -> dict:
    m = AgentMessage(session_id=session.id, role=role, content=content, payload=payload)
    db.add(m)
    db.commit()
    return {"id": m.id, "role": role, "content": content, **(payload or {}), "created_at": m.created_at.isoformat()}


# ---------------------------------------------------------------- public API

def chat(db: Session, session: AgentSession, text: str, attachments: list[str] | None = None,
         ctx: dict | None = None) -> dict:
    ctx = {**(ctx or {}), "session_id": session.id}
    user_payload = {"attachments": [a.split("__", 1)[-1] for a in attachments]} if attachments else None
    _store(db, session, "user", text, user_payload)
    if session.title == "New conversation":
        session.title = (text or (attachments or ["Schedule upload"])[0].split("__", 1)[-1])[:70]
        db.commit()

    out = None
    if GEMINI_KEY:
        try:
            out = _gemini(db, session, text, attachments or [], ctx)
        except Exception as e:  # network / quota / SDK issues → deterministic fallback
            log.warning("Gemini failed, falling back to planner: %s", e)
            out = _planner(db, session, text, attachments or [], ctx)
            out["engine_note"] = f"Gemini unavailable ({type(e).__name__}); answered by the offline planner."
    else:
        out = _planner(db, session, text, attachments or [], ctx)
    out.setdefault("engine", engine_name())
    return _store(db, session, "assistant", out.pop("content"), out)


def resolve_action(db: Session, session: AgentSession, action_id: str, approve: bool,
                   overrides: dict | None = None, ctx: dict | None = None) -> dict:
    ctx = {**(ctx or {}), "session_id": session.id}
    st = _state(session)
    action = st["pending"].pop(action_id, None)
    if not action:
        raise ValueError("This action was already handled or has expired.")
    _save_state(db, session, st)
    _mark_action(db, session, action_id, "approved" if approve else "cancelled")
    if not approve:
        return _store(db, session, "assistant", f"Cancelled **{action['title']}**. Nothing was sent or generated.",
                      {"steps": [], "suggestions": _suggest(session, st), "engine": engine_name()})
    args = {**action["args"], **{k: v for k, v in (overrides or {}).items() if v is not None}}
    step = execute(db, action["tool"], args, ctx)
    if not step["ok"]:
        content = f"⚠️ **{action['title']}** failed: {step['result']['error']}"
    elif action["tool"] == "generate_client_quote_pdf":
        r = step["result"]
        content = (f"✅ **Quotation generated** at {r['margin_percent']:g}% margin.\n\n"
                   f"- Direct cost: **{inr(r['direct_cost'])}** → selling price {inr(r['subtotal'])}\n"
                   f"- Profit: **{inr(r['profit'])}** · GST 18%: {inr(r['gst'])}\n"
                   f"- **Grand total: {inr(r['grand_total'])}** ({inr(r['rate_per_sqm'])}/m² ex-GST)\n\n"
                   "The PDF is ready to download below.")
    else:
        r = step["result"]
        content = f"✅ WhatsApp update {r['delivered']} to {r['recipient_phone']}."
    return _store(db, session, "assistant", content,
                  {"steps": [step], "project_id": session.project_id,
                   "suggestions": _suggest(session, st, after_quote=action["tool"] == "generate_client_quote_pdf"),
                   "engine": engine_name()})


def _mark_action(db, session, action_id, status):
    msgs = db.scalars(select(AgentMessage).where(AgentMessage.session_id == session.id,
                                                 AgentMessage.role == "assistant")).all()
    for m in msgs:
        pa = (m.payload or {}).get("pending_action")
        if pa and pa.get("id") == action_id:
            m.payload = {**m.payload, "pending_action": {**pa, "status": status}}
            flag_modified(m, "payload")
    db.commit()


def _suggest(session: AgentSession, st: dict, after_quote=False) -> list[str]:
    if after_quote:
        return ["Show offcut inventory", "List my projects",
                "Quote 20 windows 1800x1200mm, 6th floor in Pune"]
    if session.project_id:
        return ["Switch to 13.52mm laminated", "Re-optimize cutting with offcuts", "Show offcut inventory"]
    return ["Quote 45 butt-joint windows of 2400x1500mm for a 12th-floor project in Mumbai",
            "Is 10mm toughened safe for 1800x2100 at 60 m in Chennai?",
            "Show offcut inventory"]


# ---------------------------------------------------------------- deterministic planner

HELP_TEXT = """I'm **VitroCore**, your facade engineering copilot. I can:

- **Validate glass** against IS 875 (Part 3) wind loads for any Indian city and height
- **Size structural silicone** (bite, glueline, sausage count)
- **Optimize jumbo-sheet cutting**, reusing factory offcuts first
- **Build the BOM and a client quote PDF** (with your approval)

Give me a city, a height or floor, and window sizes, for example *"Quote 45 windows 2400x1500mm, 12th floor, Mumbai"*. You can also drop a CSV or Excel window schedule here."""


def _planner(db: Session, session: AgentSession, text: str, attachments: list[str], ctx: dict) -> dict:
    st = _state(session)
    slots = st["slots"]
    ints = nlu.intents(text or "")
    ex = nlu.extract(text or "")
    steps: list[dict] = []
    notes: list[str] = []

    # --- approvals typed in chat
    pend = list(st["pending"].values())
    if pend and ex["margin_percent"] is not None and pend[-1]["tool"] == "generate_client_quote_pdf":
        pend[-1]["args"]["margin_percent"] = ex["margin_percent"]
        _save_state(db, session, st)
        _retarget_pending(db, session, pend[-1])
        return {"content": f"Updated the pending quote to **{ex['margin_percent']:g}% margin**. Approve it on the card above when ready.",
                "steps": [], "suggestions": ["Approve the quote", "Cancel"]}
    if pend and "affirm" in ints:
        return {"content": "Please use **Approve** on the action card so the approval is recorded. "
                           "It shows exactly what will be generated or sent.", "steps": [],
                "suggestions": []}
    if pend and "deny" in ints:
        for a in pend:
            _mark_action(db, session, a["id"], "cancelled")
        st["pending"] = {}
        _save_state(db, session, st)
        return {"content": "Cancelled the pending action. Nothing was generated or sent.", "steps": [],
                "suggestions": _suggest(session, st)}

    # --- uploaded schedules
    for f in attachments:
        step = execute(db, "parse_window_schedule", {"file_url": f}, ctx)
        steps.append(step)
        if step["ok"]:
            rows = [r for r in step["result"]["rows"] if r["width_mm"] and r["height_mm"]]
            slots["panels"] = [{"tag": r["window_tag"], "width_mm": r["width_mm"], "height_mm": r["height_mm"],
                                "quantity": r["quantity"], "floor_level": r["floor_level"],
                                "notes": r["glazing_notes"], "needs_review": r["needs_review"]} for r in rows]
            if step["result"].get("rows") and step["result"]["rows"][0].get("glass_spec") and not slots.get("glass_spec"):
                try:
                    slots["glass_spec"] = parse_glass_spec(step["result"]["rows"][0]["glass_spec"]).key
                except ValueError:
                    pass
            session.project_id = None
            n_rev = step["result"]["needs_review_count"]
            total = sum(p["quantity"] for p in slots["panels"])
            skipped = [r["window_tag"] for r in step["result"]["rows"] if not (r["width_mm"] and r["height_mm"])]
            notes.append(f"📄 Parsed **{len(rows)} window types / {total} panels** from the schedule"
                         + (f" – ⚠️ **{n_rev} row(s) flagged for review** (unclear units or values)" if n_rev else "")
                         + (f". **Skipped {', '.join(skipped)}** (missing width or height) – add it on the project's Panels tab." if skipped else "."))
        else:
            notes.append(f"⚠️ Could not read the schedule: {step['result']['error']}")

    # --- simple intents that don't need full inputs
    has_dims = bool(ex["panels"]) or bool(attachments)
    if "help" in ints and not has_dims:
        return {"content": HELP_TEXT, "steps": steps, "suggestions": _suggest(session, st)}
    if "offcuts" in ints and not has_dims and not {"quote", "wind"} & ints:
        step = execute(db, "list_offcut_inventory", {"glass_spec": ex["glass_spec"]} if ex["glass_spec"] else {}, ctx)
        r = step["result"]
        by = {}
        for o in r["offcuts"]:
            by.setdefault(o["glass_spec"], []).append(o)
        lines = [f"- **{parse_glass_spec(k).label}**: {len(v)} pcs, largest {max(v, key=lambda o: o['width_mm'] * o['height_mm'])['width_mm']}×{max(v, key=lambda o: o['width_mm'] * o['height_mm'])['height_mm']} mm"
                 for k, v in by.items()]
        content = (f"**{r['count']} offcuts available** ({r['area_m2']} m²). The optimizer uses these before opening new jumbo sheets.\n\n"
                   + "\n".join(lines)) if r["count"] else "No offcuts are available in the inventory right now."
        return {"content": content, "steps": [step], "suggestions": _suggest(session, st)}
    if "projects" in ints and not has_dims and not ({"quote", "wind", "optimize"} & ints):
        step = execute(db, "list_projects", {}, ctx)
        ps = step["result"]["projects"]
        if not ps:
            return {"content": "No projects yet. Describe a job or upload a schedule to create one.", "steps": [step],
                    "suggestions": _suggest(session, st)}
        lines = [f"- **{p['name']}** · {p['city']} · {p['status']} · {p['panel_count']} panels"
                 + (f" · scrap {p['scrap_pct']}%" if p["scrap_pct"] is not None else "")
                 + (f" · {inr(p['grand_total'])}" if p["grand_total"] else "") for p in ps[:8]]
        return {"content": "Here are your latest projects:\n\n" + "\n".join(lines), "steps": [step],
                "suggestions": _suggest(session, st)}
    if "breakage" in ints and not has_dims:
        return {"content": "Breakage reports come in from site over WhatsApp (e.g. *BROKEN W1-03*). I look up the panel, "
                           "plan a priority re-cut (offcuts first) and raise an approval in **Site Ops → Alerts**. "
                           "You can try it in the WhatsApp simulator on the Site Ops page.", "steps": [],
                "suggestions": _suggest(session, st)}

    # --- follow-ups on the active project
    if session.project_id and not has_dims:
        if ex["glass_spec"] and ("change_spec" in ints or ints & {"wind", "optimize", "quote"} or len(text) < 40):
            return _rerun_with_spec(db, session, st, ex, ctx, steps)
        if ints & {"optimize", "quote"}:
            return _continue_project(db, session, st, ex, ctx, steps, ints)

    # --- merge slots
    for k in ("city", "building_height_m", "height_note", "glass_spec", "margin_percent", "name", "client",
              "glazing_system", "zone", "terrain"):
        if ex.get(k) is not None:
            slots[k] = ex[k]
    if ex["panels"]:
        slots["panels"] = ex["panels"]
        session.project_id = None

    engineering = bool(ints & {"quote", "wind", "silicone", "optimize"}) or bool(slots.get("panels")) or attachments
    if not engineering and not any(slots.get(k) for k in ("city", "building_height_m")):
        _save_state(db, session, st)
        return {"content": "\n\n".join(notes + [HELP_TEXT]) if notes else
                "I can help with wind-load checks, silicone sizing, cutting optimization and quotes. "
                "Tell me the **city**, **height/floor** and **window sizes** (W×H mm with quantities).",
                "steps": steps, "suggestions": _suggest(session, st)}

    if not st.get("goal") or ints & {"quote", "wind", "silicone", "optimize"}:
        st["goal"] = "quote" if ("quote" in ints or "optimize" in ints) else \
            ("silicone" if "silicone" in ints else ("wind" if "wind" in ints else st.get("goal") or "quote"))

    missing = []
    if not slots.get("city"):
        missing.append("**city**")
    if not slots.get("building_height_m"):
        missing.append("**installation height** (metres or floor number)")
    if not slots.get("panels"):
        missing.append("**window sizes** (W×H in mm, with quantities)")
    if missing:
        _save_state(db, session, st)
        have = []
        if slots.get("city"):
            have.append(slots["city"])
        if slots.get("building_height_m"):
            have.append(f"{slots['building_height_m']} m")
        if slots.get("panels"):
            have.append(f"{sum(p['quantity'] for p in slots['panels'])} panels")
        prefix = f"Got it ({', '.join(have)}). " if have else ""
        return {"content": "\n\n".join(notes + [f"{prefix}To run the IS 875 check I still need the " + ", ".join(missing) + "."]),
                "steps": steps, "missing": [m.replace("*", "") for m in missing],
                "suggestions": _missing_suggestions(slots)}

    return _run_pipeline(db, session, st, ctx, steps, notes)


def _missing_suggestions(slots: dict) -> list[str]:
    s = []
    if not slots.get("city"):
        s += ["Mumbai", "Bengaluru", "Chennai"]
    if not slots.get("building_height_m"):
        s += ["12th floor", "45 m"]
    if not slots.get("panels"):
        s += ["40 windows 2400x1500mm"]
    return s[:4]


def _retarget_pending(db, session, action):
    msgs = db.scalars(select(AgentMessage).where(AgentMessage.session_id == session.id,
                                                 AgentMessage.role == "assistant")).all()
    for m in msgs:
        pa = (m.payload or {}).get("pending_action")
        if pa and pa.get("id") == action["id"]:
            m.payload = {**m.payload, "pending_action": {**pa, "args": action["args"]}}
            flag_modified(m, "payload")
    db.commit()


def _distinct_sizes(panels: list[dict]) -> list[dict]:
    seen, out = set(), []
    for p in sorted(panels, key=lambda p: -(p["width_mm"] * p["height_mm"])):
        k = (p["width_mm"], p["height_mm"])
        if k not in seen:
            seen.add(k)
            out.append(p)
    return out[:6]  # largest panes govern; cap tool calls


def _run_pipeline(db, session, st, ctx, steps, notes) -> dict:
    slots = st["slots"]
    goal = st.get("goal", "quote")
    spec_assumed = not slots.get("glass_spec")
    spec = slots.get("glass_spec") or DEFAULT_SPEC
    family = "laminated" if "laminated" in spec else "toughened"
    city, height = slots["city"], float(slots["building_height_m"])
    panels = slots["panels"]
    lines = list(notes)
    if slots.get("height_note"):
        lines.append(f"📐 Height basis: {slots['height_note']}.")
    if spec_assumed:
        lines.append(f"🔎 No glass spec given – starting from **{parse_glass_spec(spec).label}**.")
    if goal != "wind" and any(p.get("qty_assumed") for p in panels):
        lines.append("ℹ️ Quantity not stated for some sizes – assumed **1 each**. Tell me the quantities to update.")

    # 1. IS 875 checks per distinct size
    wind_steps = []
    for p in _distinct_sizes(panels):
        s = execute(db, "calculate_is875_wind_load", {
            "city": city, "building_height_m": height, "window_width_mm": p["width_mm"],
            "window_height_mm": p["height_mm"], "glass_spec": spec,
            "terrain": slots.get("terrain") or 3, "zone": slots.get("zone") or "typical"}, ctx)
        steps.append(s)
        wind_steps.append(s)
        if not s["ok"]:
            _save_state(db, session, st)
            return {"content": "\n\n".join(lines + [f"⚠️ {s['result']['error']}"]), "steps": steps,
                    "suggestions": ["Mumbai", "Delhi", "Bengaluru"]}
    w0 = wind_steps[0]["result"]
    failing = [s["result"] for s in wind_steps if not s["result"]["safe"]]
    worst = max((s["result"] for s in wind_steps), key=lambda r: r["check"]["utilisation"])
    pressure = w0["design_pressure_kpa"]
    lines.append(f"**IS 875 design pressure: {pressure} kPa** – {w0['city']}, Vb {w0['factors']['Vb']} m/s, "
                 f"k2 {w0['factors']['k2']} at {height:g} m ({w0['terrain_label'].split(' – ')[0]}, {w0['zone']} zone).")

    final_spec = spec
    if failing:
        key = f"min_safe_{family}"
        other = "min_safe_laminated" if family == "toughened" else "min_safe_toughened"
        candidates = [r[key]["glass_spec"] for r in failing if r.get(key)]
        if len(candidates) == len(failing):
            from ..engines.glass import CANDIDATES_LAMINATED, CANDIDATES_TOUGHENED
            order = CANDIDATES_TOUGHENED if family == "toughened" else CANDIDATES_LAMINATED
            final_spec = max(candidates, key=order.index)
        else:
            alt = [r[other]["glass_spec"] for r in failing if r.get(other)]
            final_spec = alt[0] if alt else None
        bad = failing[0]
        lines.append(f"🚨 **{parse_glass_spec(spec).label} is NOT safe** for {bad['window_width_mm']}×{bad['window_height_mm']} mm: "
                     f"{bad['check']['governing']} governs at **{pct(bad['check']['utilisation'])} utilisation** "
                     f"(stress {bad['check']['max_stress_mpa']}/{bad['check']['allowable_stress_mpa']} MPa, "
                     f"deflection {bad['check']['max_deflection_mm']}/{bad['check']['allowable_deflection_mm']} mm).")
        if not final_spec:
            _save_state(db, session, st)
            return {"content": "\n\n".join(lines + ["No standard toughened or laminated make-up passes for this size. "
                                                      "Reduce the pane size or add an intermediate support."]),
                    "steps": steps, "suggestions": []}
        alt_l = bad.get("min_safe_laminated")
        lines.append(f"✅ Switching to the minimum safe spec: **{parse_glass_spec(final_spec).label}**"
                     + (f" (laminated alternative: {parse_glass_spec(alt_l['glass_spec']).label})" if alt_l and family == "toughened" else "") + ".")
        gov = max(failing, key=lambda r: r["check"]["utilisation"])
        s = execute(db, "calculate_is875_wind_load", {
            "city": city, "building_height_m": height, "window_width_mm": gov["window_width_mm"],
            "window_height_mm": gov["window_height_mm"], "glass_spec": final_spec,
            "terrain": slots.get("terrain") or 3, "zone": slots.get("zone") or "typical"}, ctx)
        steps.append(s)
        worst = s["result"]
    else:
        lines.append(f"✅ **{parse_glass_spec(spec).label} passes** – governing pane {worst['window_width_mm']}×{worst['window_height_mm']} mm at "
                     f"**{pct(worst['check']['utilisation'])} utilisation** ({worst['check']['governing']}).")

    if goal == "wind":
        slots["glass_spec"] = final_spec
        _save_state(db, session, st)
        lines.append("_Screening check per IS 875-3; final design needs facade-engineer sign-off._")
        return {"content": "\n\n".join(lines), "steps": steps,
                "suggestions": ["Quote this with 18% margin", "Size the structural silicone", "Try 13.52mm laminated"]}

    # 2. Structural silicone
    short = max(min(p["width_mm"], p["height_mm"]) for p in panels)
    perim = round(sum(2 * (p["width_mm"] + p["height_mm"]) * p["quantity"] for p in panels) / 1000, 2)
    s = execute(db, "calculate_structural_silicone", {"wind_pressure_kpa": pressure, "short_span_mm": short,
                                                      "perimeter_m": perim, "sealant_grade": "dowsil_995"}, ctx)
    steps.append(s)
    sil = s["result"]
    lines.append(f"🧴 **Silicone:** {sil['bite_mm']} mm bite × {sil['glueline_thickness_mm']} mm glueline "
                 f"→ **{sil['structural_sausages_600ml']} sausages** DOWSIL 995 + {sil['weatherseal_sausages_600ml']} DOWSIL 795.")
    if goal == "silicone":
        _save_state(db, session, st)
        return {"content": "\n\n".join(lines), "steps": steps,
                "suggestions": ["Quote this with 18% margin", "Optimize the cutting"]}

    # 3. Create project (persists + project-wide validation)
    total_qty = sum(p["quantity"] for p in panels)
    name = slots.get("name") or f"{city} – {total_qty} panels @ {height:g} m"
    s = execute(db, "create_project", {
        "name": name, "client": slots.get("client"), "city": city, "building_height_m": height,
        "glass_spec": final_spec, "glazing_system": slots.get("glazing_system"),
        "terrain": slots.get("terrain") or 3, "zone": slots.get("zone") or "typical",
        "panels": [{k: p.get(k) for k in ("tag", "width_mm", "height_mm", "quantity", "floor_level", "notes", "needs_review")} for p in panels]}, ctx)
    steps.append(s)
    if not s["ok"]:
        _save_state(db, session, st)
        return {"content": "\n\n".join(lines + [f"⚠️ {s['result']['error']}"]), "steps": steps}
    pid = s["result"]["project"]["id"]
    session.project_id = pid

    # 4. Optimize cutting
    s = execute(db, "optimize_2d_glass_cutting", {"project_id": pid, "check_offcuts": True}, ctx)
    steps.append(s)
    if not s["ok"]:
        _save_state(db, session, st)
        return {"content": "\n\n".join(lines + [f"⚠️ {s['result']['error']}"]), "steps": steps, "project_id": pid}
    c = s["result"]
    scrap_flag = "✅" if c["scrap_pct"] <= c["target_scrap_pct"] else "⚠️"
    lines.append(f"✂️ **Cutting:** {c['panel_count']} panels on **{c['jumbo_sheets']} jumbo sheets**"
                 + (f" + {c['offcuts_used']} reused offcuts" if c["offcuts_used"] else "")
                 + f" · net scrap **{c['scrap_pct']}%** {scrap_flag} (target <3%)"
                 + (f" · {c['reusable_remnant_area_m2']:.1f} m² of reusable remnants" if c["reusable_remnant_area_m2"] else "") + ".")

    # 5. Quote → approval
    margin = slots.get("margin_percent") or pricing.get_prices(db, session.organization_id)["commercial"]["default_margin_pct"]
    action = _pending(st, "generate_client_quote_pdf", {"project_id": pid, "margin_percent": margin},
                      f"Compile the BOM, labour and 18% GST into a client PDF for “{name}”.")
    st["slots"], st["goal"] = {}, None
    _save_state(db, session, st)
    lines.append(f"📄 Ready to generate the client quote at **{margin:g}% margin**. Review and approve below.")
    return {"content": "\n\n".join(lines), "steps": steps, "pending_action": action, "project_id": pid,
            "suggestions": ["Make it 22% margin", "Switch to 13.52mm laminated", "Show offcut inventory"]}


def _rerun_with_spec(db, session, st, ex, ctx, steps) -> dict:
    pid = session.project_id
    s = execute(db, "update_project_glass_spec", {"project_id": pid, "glass_spec": ex["glass_spec"]}, ctx)
    steps.append(s)
    if not s["ok"]:
        return {"content": f"⚠️ {s['result']['error']}", "steps": steps, "project_id": pid}
    w = s["result"]["wind"]
    label = parse_glass_spec(ex["glass_spec"]).label
    if not w["all_safe"]:
        _save_state(db, session, st)
        return {"content": f"🚨 **{label} fails** IS 875 for {', '.join(w['failing_panels'])} "
                           f"({pct(w['max_utilisation'])} utilisation). Minimum safe: "
                           f"**{parse_glass_spec(w['recommended_glass_spec']).label if w['recommended_glass_spec'] else 'none'}**.",
                "steps": steps, "project_id": pid,
                "suggestions": [f"Switch to {w['recommended_glass_spec']}"] if w["recommended_glass_spec"] else []}
    return _continue_project(db, session, st, ex, ctx, steps, {"quote"},
                             prefix=f"✅ **{label} passes** at {pct(w['max_utilisation'])} utilisation "
                                    f"({w['design_pressure_kpa']} kPa).")


def _continue_project(db, session, st, ex, ctx, steps, ints, prefix: str = "") -> dict:
    pid = session.project_id
    s = execute(db, "optimize_2d_glass_cutting", {"project_id": pid, "check_offcuts": True}, ctx)
    steps.append(s)
    if not s["ok"]:
        return {"content": f"⚠️ {s['result']['error']}", "steps": steps, "project_id": pid}
    c = s["result"]
    lines = [prefix] if prefix else []
    lines.append(f"✂️ Re-optimized: **{c['jumbo_sheets']} jumbo sheets**"
                 + (f" + {c['offcuts_used']} offcuts" if c["offcuts_used"] else "")
                 + f", net scrap **{c['scrap_pct']}%**.")
    for a in list(st["pending"].values()):
        _mark_action(db, session, a["id"], "superseded")
    st["pending"] = {}
    out = {"steps": steps, "project_id": pid, "suggestions": _suggest(session, st)}
    if "quote" in ints or ex.get("margin_percent"):
        margin = ex.get("margin_percent") or pricing.get_prices(db, session.organization_id)["commercial"]["default_margin_pct"]
        out["pending_action"] = _pending(st, "generate_client_quote_pdf", {"project_id": pid, "margin_percent": margin},
                                         "Compile the updated BOM, labour and GST into a client PDF.")
        lines.append(f"📄 Updated quote ready at **{margin:g}% margin** – approve below.")
    _save_state(db, session, st)
    out["content"] = "\n\n".join(lines)
    return out


# ---------------------------------------------------------------- Gemini function calling

def _for_llm(step: dict) -> dict:
    r = step["result"]
    try:
        text = json.dumps(r, default=str)
    except TypeError:
        text = str(r)
    if len(text) > 6000:
        r = {k: v for k, v in r.items() if not isinstance(v, (list, dict))} if isinstance(r, dict) else {"summary": text[:6000]}
    return {"ok": step["ok"], "result": r}


def _gemini(db: Session, session: AgentSession, text: str, attachments: list[str], ctx: dict) -> dict:
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=GEMINI_KEY)
    st = _state(session)
    decls = [types.FunctionDeclaration(name=t.name, description=t.description, parameters_json_schema=t.parameters)
             for t in TOOLS.values()]
    system = SYSTEM_PROMPT + (f"\n\nActive project id in this conversation: {session.project_id}" if session.project_id else "")
    config = types.GenerateContentConfig(
        system_instruction=system, tools=[types.Tool(function_declarations=decls)], temperature=0.2,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True))

    contents = []
    for m in history(db, session.id)[-21:-1]:
        if m["content"]:
            contents.append(types.Content(role="user" if m["role"] == "user" else "model",
                                          parts=[types.Part.from_text(text=m["content"])]))
    user_text = text or "Please process the uploaded schedule."
    if attachments:
        user_text += "\n\n" + "\n".join(f"[Uploaded schedule – file_url: {a}]" for a in attachments)
    contents.append(types.Content(role="user", parts=[types.Part.from_text(text=user_text)]))

    steps, pending, project_id = [], None, session.project_id
    final_text = ""
    for _ in range(10):
        resp = client.models.generate_content(model=GEMINI_MODEL, contents=contents, config=config)
        calls = resp.function_calls or []
        if not calls:
            final_text = resp.text or ""
            break
        contents.append(resp.candidates[0].content)
        parts = []
        for call in calls:
            args = dict(call.args or {})
            tool = TOOLS.get(call.name)
            if tool and tool.requires_confirmation:
                pending = _pending(st, call.name, args, tool.description.split(" – ")[0])
                response = {"status": "awaiting_user_approval",
                            "note": "An approval card has been shown to the user. Do not call this tool again."}
            else:
                step = execute(db, call.name, args, ctx)
                steps.append(step)
                response = _for_llm(step)
                if step["ok"] and isinstance(step["result"], dict):
                    project_id = (step["result"].get("project") or {}).get("id") or step["result"].get("project_id") or project_id
            parts.append(types.Part.from_function_response(name=call.name, response=response))
        contents.append(types.Content(role="user", parts=parts))
    else:
        final_text = "I stopped after several tool calls. Tell me how you'd like to proceed."

    session.project_id = project_id
    _save_state(db, session, st)
    return {"content": final_text, "steps": steps, "pending_action": pending, "project_id": project_id,
            "suggestions": _suggest(session, st)}
