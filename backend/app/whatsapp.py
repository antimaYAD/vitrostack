"""WhatsApp Business API integration + site-foreman bot.

If WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID are set, messages go out through the
Meta Graph API; otherwise they are recorded as simulated messages (visible in the
Site Ops simulator), so the full flow can be demoed without credentials.
"""
from __future__ import annotations

import json
import os
import re
import urllib.request

from sqlalchemy.orm import Session

from .db import DEFAULT_ORG, Alert, Offcut, SiteEvent
from .engines import cutting
from .engines.glass import parse_glass_spec
from . import services

TOKEN = os.getenv("WHATSAPP_TOKEN")
PHONE_ID = os.getenv("WHATSAPP_PHONE_NUMBER_ID")
VERIFY_TOKEN = os.getenv("WHATSAPP_VERIFY_TOKEN", "vitrostack-verify")


def is_live() -> bool:
    return bool(TOKEN and PHONE_ID)


def _deliver(phone: str, text: str) -> str:
    if not is_live():
        return "simulated"
    body = json.dumps({"messaging_product": "whatsapp", "to": phone.lstrip("+"), "type": "text",
                       "text": {"body": text}}).encode()
    req = urllib.request.Request(f"https://graph.facebook.com/v21.0/{PHONE_ID}/messages", data=body,
                                 headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return "sent" if r.status < 300 else f"error {r.status}"


def send_site_update(db: Session, phone: str, batch_id: str, status: str, media_url: str | None = None,
                     org: str = DEFAULT_ORG) -> dict:
    text = f"📦 {batch_id + ': ' if batch_id else ''}{status}"
    if media_url:
        text += f"\n{media_url}"
    delivery = _deliver(phone, text)
    db.add(SiteEvent(organization_id=org, phone=phone, direction="out", text=text))
    db.commit()
    return {"delivered": delivery, "recipient_phone": phone, "text": text}


def _reply(db: Session, phone: str, text: str, org: str, project_id: str | None = None) -> str:
    _deliver(phone, text)
    db.add(SiteEvent(organization_id=org, phone=phone, direction="out", text=text, project_id=project_id))
    return text


HELP = ("Hi 👋 Send:\n• BROKEN W1-03 – report broken glass\n• DONE W1-01 to W1-10 – mark installed\n"
        "• STATUS – today's batches")


def handle_incoming(db: Session, phone: str, text: str, org: str = DEFAULT_ORG) -> dict:
    db.add(SiteEvent(organization_id=org, phone=phone, direction="in", text=text))
    db.commit()
    msg = text.strip()
    upper = msg.upper()

    m = re.search(r"\b(BROKEN|BROKE|CRACK(?:ED)?|DAMAGED?|TOOT[AI])\b[\s:#-]*([A-Z]{1,4}\d+(?:-\d+)?)", upper)
    if m:
        return _breakage(db, phone, m.group(2), org)

    m = re.search(r"\b(DONE|INSTALLED|FIXED|COMPLETED?)\b\s*(.*)", upper)
    if m:
        what = m.group(2).strip() or "batch"
        db.add(Alert(organization_id=org, kind="progress", title=f"Site update from {phone}",
                     body=f"Installed: {what}", status="approved"))
        reply = _reply(db, phone, f"✅ Noted. {what} marked installed. Thank you!", org)
        db.commit()
        return {"action": "progress", "reply": reply}

    if "STATUS" in upper:
        reply = _reply(db, phone, "📋 Today: check the batch list from your supervisor. "
                                  "Reply BROKEN <panel ID> for any damaged glass.", org)
        db.commit()
        return {"action": "status", "reply": reply}

    reply = _reply(db, phone, HELP, org)
    db.commit()
    return {"action": "help", "reply": reply}


def _breakage(db: Session, phone: str, panel_uid: str, org: str) -> dict:
    found = services.find_panel_by_uid(db, panel_uid, org)
    if not found:
        reply = _reply(db, phone, f"⚠️ Panel {panel_uid} not found. Check the ID on the glass label and resend.", org)
        db.commit()
        return {"action": "breakage_unknown", "reply": reply}
    project, panel, uid = found
    spec = parse_glass_spec(project.glass_spec).key
    offs = services.available_offcuts(db, spec, org)
    plan = cutting.optimize(
        [{"tag": panel.tag, "width_mm": panel.width_mm, "height_mm": panel.height_mm, "quantity": 1, "glass_spec": spec}],
        services.offcut_pieces(offs), True)
    sheet = plan["groups"][0]["sheets"][0]
    source = (f"offcut #{sheet['offcut_id']} ({sheet['width_mm']}×{sheet['height_mm']})"
              if sheet["source"] == "offcut" else "a new jumbo sheet")
    alert = Alert(organization_id=org, project_id=project.id, kind="breakage",
                  title=f"Broken panel {uid} – {project.name}",
                  body=(f"{panel.width_mm}×{panel.height_mm} mm {parse_glass_spec(project.glass_spec).label}. "
                        f"Priority re-cut planned from {source}. Reported by {phone}."),
                  payload={"panel_uid": uid, "tag": panel.tag, "width_mm": panel.width_mm,
                           "height_mm": panel.height_mm, "glass_spec": spec, "phone": phone,
                           "source": sheet["source"], "offcut_id": sheet["offcut_id"], "plan": plan})
    db.add(alert)
    db.commit()
    reply = _reply(db, phone, f"✅ Got it. {uid} logged as broken. Replacement is being planned – "
                              "you will get a message once the office approves.", org, project.id)
    db.commit()
    return {"action": "breakage", "alert_id": alert.id, "reply": reply}


def approve_breakage(db: Session, alert: Alert) -> dict:
    p = alert.payload or {}
    if p.get("offcut_id"):
        o = db.get(Offcut, int(p["offcut_id"]))
        if o and o in services.available_offcuts(db, o.glass_spec, o.organization_id):
            services.reserve_offcut(db, o, 1, alert.project_id)
    alert.status = "approved"
    db.commit()
    text = (f"✅ Replacement for {p.get('panel_uid')} approved. Cutting from "
            f"{'stock offcut' if p.get('source') == 'offcut' else 'new sheet'} today. "
            "Keep the opening covered.")
    if p.get("phone"):
        _reply(db, p["phone"], text, alert.organization_id, alert.project_id)
        db.commit()
    return {"status": "approved", "notified": p.get("phone"), "text": text}
