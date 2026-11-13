"""Demo data so the dashboard is meaningful on first launch."""
from __future__ import annotations

import logging

from sqlalchemy import func, select

from . import services
from .db import DEFAULT_ORG, Offcut, Project, SessionLocal

log = logging.getLogger("seed")

OFFCUTS = [
    ("12mm_toughened", 2450, 1560, "R-01"), ("12mm_toughened", 1820, 1250, "R-01"),
    ("12mm_toughened", 1200, 900, "R-02"), ("12mm_toughened", 960, 640, "R-02"),
    ("10mm_toughened", 2100, 1400, "R-03"), ("10mm_toughened", 1500, 1100, "R-03"),
    ("10mm_toughened", 800, 600, "R-04"), ("13.52mm_laminated", 2300, 1600, "R-05"),
    ("13.52mm_laminated", 1400, 1000, "R-05"), ("8mm_toughened", 1600, 1200, "R-06"),
    ("6mm_toughened", 1100, 900, "R-06"),
]

PROJECTS = [
    {"name": "Lodha Skyline – Tower B", "client": "Lodha Developers", "city": "Mumbai", "building_height_m": 42.9,
     "glass_spec": "17.52mm_laminated", "glazing_system": "Butt-joint structural glazing", "terrain": 3,
     "panels": [{"tag": "W1", "width_mm": 2400, "height_mm": 1500, "quantity": 24, "floor_level": "10-12"},
                {"tag": "W2", "width_mm": 1800, "height_mm": 1500, "quantity": 12, "floor_level": "10-12"},
                {"tag": "W3", "width_mm": 1200, "height_mm": 2100, "quantity": 8, "floor_level": "12"}],
     "stage": "quoted", "margin": 18},
    {"name": "Prestige Tech Park – Block 4", "client": "Prestige Group", "city": "Bengaluru", "building_height_m": 30,
     "glass_spec": "10mm_toughened", "glazing_system": "Unitized curtain wall",
     "panels": [{"tag": "CW1", "width_mm": 1500, "height_mm": 2700, "quantity": 30, "floor_level": "1-8"},
                {"tag": "CW2", "width_mm": 1200, "height_mm": 2700, "quantity": 16, "floor_level": "1-8"}],
     "stage": "optimized"},
    {"name": "Marina Heights", "client": "Casagrand", "city": "Chennai", "building_height_m": 64,
     "glass_spec": "8mm_toughened", "glazing_system": "Structural silicone glazing",
     "panels": [{"tag": "F1", "width_mm": 2000, "height_mm": 1800, "quantity": 20, "floor_level": "15-18"}],
     "stage": "validated"},
    {"name": "DLF Cyber Annex", "client": "DLF", "city": "Gurugram", "building_height_m": 24,
     "glass_spec": "12mm_toughened", "glazing_system": "Semi-unitized curtain wall",
     "panels": [{"tag": "G1", "width_mm": 1600, "height_mm": 2400, "quantity": 18, "floor_level": "2-6"}],
     "stage": "draft"},
]


def seed():
    db = SessionLocal()
    try:
        if db.scalar(select(func.count()).select_from(Project)):
            return
        log.info("Seeding demo data")
        for spec, w, h, rack in OFFCUTS:
            db.add(Offcut(organization_id=DEFAULT_ORG, glass_spec=spec, width_mm=w, height_mm=h, rack=rack,
                          source="Factory stock"))
        db.commit()
        for d in PROJECTS:
            d = dict(d)
            stage, margin = d.pop("stage"), d.pop("margin", 18)
            p = services.create_project(db, d)
            if stage in ("validated", "optimized", "quoted"):
                services.run_wind_check(db, p)
            if stage in ("optimized", "quoted") and p.wind and p.wind["all_safe"]:
                services.run_cutting(db, p, True)
            if stage == "quoted" and p.cutting:
                services.run_quote(db, p, margin)
    finally:
        db.close()
