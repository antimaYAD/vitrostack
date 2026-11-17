"""Facade design canvas: IS 875 wind-load validation, BOM extraction and DXF export.

All three endpoints take the same parametric JSON (FacadeIn). The browser never sends geometry it has
computed itself: net glass sizes, bites and quantities all come from engines.facade.
"""
from __future__ import annotations

import re
from typing import Literal

from fastapi import Response
from pydantic import BaseModel, Field, model_validator

from ..engines import facade
from ..engines.facade_dxf import export_dxf
from ..engines.wind import ZONES, design_pressure
from .deps import protected_router

router = protected_router()

Operation = Literal["fixed", "sliding_left", "sliding_right", "casement", "top_hung", "tilt_turn", "door"]
Infill = Literal["glass", "spandrel", "louvre"]
GlassSpec = Literal["10mm_toughened", "12mm_toughened", "13.52mm_laminated_toughened", "24mm_dgu"]
TrackSystem = Literal["2_track_recessed", "3_track_heavy_duty"]


class JointIn(BaseModel):
    type: Literal["aluminum_mullion", "silicone_butt_joint"]
    gap_mm: float = Field(default=8, ge=4, le=25)
    sealant: str = "Dow_Dowsil_995"
    backing: Literal["none", "glass_fin"] = "none"  # butt joints only
    profile_mm: float | None = None
    required_bite_mm: float | None = None  # output field; ignored on input


class PaneIn(BaseModel):
    pane_index: int = Field(ge=1)
    y_mm: int | None = None
    height_mm: int = Field(gt=0, le=12000)
    operation: Operation = "fixed"
    glass_spec: GlassSpec = "12mm_toughened"
    track_system: TrackSystem | None = None
    infill: Infill = "glass"


class BayIn(BaseModel):
    bay_index: int = Field(ge=1)
    x_mm: int | None = None
    width_mm: int = Field(gt=0, le=30000)
    height_mm: int | None = Field(default=None, gt=0, le=12000)
    operation: Operation | None = None
    glass_spec: GlassSpec | None = None
    track_system: TrackSystem | None = None
    infill: Infill | None = None
    right_joint: JointIn | None = None
    panes: list[PaneIn] | None = Field(default=None, max_length=12)


class SiteIn(BaseModel):
    city: str
    height_m: float = Field(gt=0, le=500)
    terrain: int = Field(default=3, ge=1, le=4)
    zone: str = "typical"


class FacadeIn(BaseModel):
    elevation_id: str = Field(min_length=1, max_length=40)
    overall_width_mm: int = Field(ge=300, le=30000)
    overall_height_mm: int = Field(ge=300, le=12000)
    wind_pressure_kpa: float = Field(gt=0, le=10)
    frame_mm: int = Field(default=50, ge=20, le=200)
    mullion_mm: int = Field(default=50, ge=20, le=200)
    transom_mm: int = Field(default=50, ge=20, le=200)
    quantity: int = Field(default=1, ge=1, le=1000)
    site: SiteIn | None = None
    bays: list[BayIn] = Field(min_length=1, max_length=40)

    @model_validator(mode="after")
    def _indices(self):
        idx = sorted(b.bay_index for b in self.bays)
        if idx != list(range(1, len(self.bays) + 1)):
            raise ValueError("bay_index must run 1, 2, 3 … without gaps")
        return self


def _load(body: FacadeIn) -> tuple[facade.Elevation, dict | None]:
    data = body.model_dump()
    wind = None
    if body.site:
        if body.site.zone not in ZONES:
            raise ValueError(f"Zone must be one of {list(ZONES)}")
        wind = design_pressure(body.site.city, body.site.height_m, body.site.terrain, body.site.zone)
        data["wind_pressure_kpa"] = wind["design_pressure_kpa"]
    return facade.normalise(data), wind


@router.post("/canvas/validate-wind-load")
def validate_wind_load(body: FacadeIn):
    e, wind = _load(body)
    return {**facade.validate(e), "wind": wind}


@router.post("/canvas/extract-bom")
def extract_bom(body: FacadeIn):
    e, _ = _load(body)
    facade.validate(e)  # adds the bite-depth warnings to the issues list
    return facade.bom(e)


@router.post("/canvas/export-dxf")
def export_dxf_file(body: FacadeIn):
    e, _ = _load(body)
    check = facade.validate(e)
    for j in check["joints"]:  # annotate bites on the drawing
        if j["type"] == "silicone_butt_joint":
            e.bays[j["after_bay"] - 1].right_joint = {**(e.bays[j["after_bay"] - 1].right_joint or {}),
                                                      "required_bite_mm": j["required_bite_mm"]}
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", e.elevation_id).strip("_") or "elevation"
    return Response(export_dxf(e, check), media_type="application/dxf",
                    headers={"Content-Disposition": f'attachment; filename="{safe}.dxf"'})


@router.get("/canvas/options")
def canvas_options():
    return {
        "operations": [{"value": k, "label": v} for k, v in facade.OPERATIONS.items()],
        "glass": [{"value": k, "label": v["label"], "short": v["short"]} for k, v in facade.GLASS.items()],
        "infills": [{"value": k, "label": v} for k, v in facade.INFILLS.items()],
        "tracks": [{"value": k, **v} for k, v in facade.TRACKS.items()],
        "joints": [{"value": k, "label": v} for k, v in facade.JOINTS.items()],
        "constants": {"rebate_mm": facade.REBATE_MM, "sash_mm": facade.SASH_MM,
                      "slide_overlap_mm": facade.SLIDE_OVERLAP_MM, "min_bay_mm": facade.MIN_BAY_MM,
                      "min_pane_mm": facade.MIN_PANE_MM},
    }
