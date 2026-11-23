"""Stand-alone engineering tools (wind, silicone, quick cutting) and schedule uploads."""
from __future__ import annotations

from fastapi import Depends, File, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from .. import pricing, services
from ..db import get_db
from ..engines import cutting, schedule_parser, silicone, wind
from ..engines.glass import parse_glass_spec
from ..uploads import save_upload
from .deps import org_id, protected_router
from .projects import PanelIn

router = protected_router()


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


@router.post("/engineering/wind")
def eng_wind(body: WindIn):
    return wind.calculate_is875_wind_load(**body.model_dump())


@router.post("/engineering/silicone")
def eng_silicone(body: SiliconeIn, db: Session = Depends(get_db), org: str = Depends(org_id)):
    return silicone.calculate_structural_silicone(**body.model_dump(), sealant_prices=pricing.get_prices(db, org)["sealants"])


@router.post("/engineering/cutting")
def eng_cutting(body: CuttingIn, db: Session = Depends(get_db), org: str = Depends(org_id)):
    spec = parse_glass_spec(body.glass_spec).key
    offs = services.available_offcuts(db, spec, org) if body.check_offcuts else []
    panels = [{**x.model_dump(), "glass_spec": spec} for x in body.panels]
    return cutting.optimize(panels, services.offcut_pieces(offs), body.check_offcuts, body.allow_rotate)


@router.post("/uploads")
async def upload(file: UploadFile = File(...)):
    content = await file.read()
    file_id = save_upload(file.filename or "schedule.csv", content)
    try:
        preview = schedule_parser.parse_file(file.filename or "", content)
    except ValueError as e:
        preview = {"error": str(e)}
    return {"file_id": file_id, "filename": file.filename, "size": len(content), "preview": preview}
