"""Admin: organisation price list and its change history."""
from __future__ import annotations

from fastapi import Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import auth, pricing
from ..db import User, get_db
from ..engines.glass import parse_glass_spec
from ..engines.rates import PRICE_SCHEMA, defaults
from .deps import org_id, protected_router

router = protected_router()


class PricesIn(BaseModel):
    prices: dict[str, dict[str, float]]


@router.get("/admin/prices", dependencies=[Depends(auth.require_admin)])
def admin_prices(db: Session = Depends(get_db), org: str = Depends(org_id)):
    schema = {k: {**v, "items": {ik: dict(iv) for ik, iv in v["items"].items()}} for k, v in PRICE_SCHEMA.items()}
    for key, item in schema["glass"]["items"].items():
        item["label"] = parse_glass_spec(key).label
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
