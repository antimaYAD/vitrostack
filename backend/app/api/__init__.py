"""HTTP API, split by feature area.

    auth         sign-in / sign-out / me / password                 (public)
    users        admin: user management                             (admin)
    platform     superadmin: companies and their admins             (superadmin)
    system       health (public), reference data, dashboard
    projects     projects, validation, cutting, quotes, remnants
    engineering  stand-alone wind / silicone / cutting tools, uploads
    inventory    offcut inventory
    agent        VitroCore copilot sessions and tool logs
    whatsapp     WhatsApp webhook (public), simulator, message log
    alerts       site-ops alerts
    pricing      admin: price list and history                      (admin)
    designs      saved window designs and facade elevations
    canvas       facade studio: wind-load validation, BOM, DXF export
"""
from __future__ import annotations

from . import (agent, alerts, auth, canvas, designs, engineering, inventory, platform, pricing, projects, system, users,
               whatsapp)

# Registered in the same order as the original single-file layout.
routers = [
    auth.router,
    users.router,
    platform.router,
    system.public,
    whatsapp.public,
    system.router,
    projects.router,
    engineering.router,
    inventory.router,
    agent.router,
    whatsapp.router,
    alerts.router,
    pricing.router,
    designs.router,
    canvas.router,
]
