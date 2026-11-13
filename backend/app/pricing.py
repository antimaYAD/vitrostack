"""Organisation price lists: read (defaults + overrides), validate, save with an audit trail."""
from __future__ import annotations

import math

from sqlalchemy import select
from sqlalchemy.orm import Session

from .db import DEFAULT_ORG, PriceChange, PriceList
from .engines.rates import PRICE_SCHEMA, defaults, merged



def get_prices(db: Session, org: str = DEFAULT_ORG) -> dict:
    row = db.get(PriceList, org)
    return merged(row.data if row else None)


def prices_updated_at(db: Session, org: str = DEFAULT_ORG) -> str | None:
    row = db.get(PriceList, org)
    return row.updated_at.isoformat() if row and row.updated_at else None


def validate(data: dict) -> dict:
    """Return a clean full price list or raise ValueError naming the bad field."""
    clean = defaults()
    for section, items in (data or {}).items():
        if section not in clean or not isinstance(items, dict):
            raise ValueError(f"Unknown price section '{section}'")
        for key, v in items.items():
            if key not in clean[section]:
                raise ValueError(f"Unknown price item '{section}.{key}'")
            try:
                v = float(v)
            except (TypeError, ValueError):
                raise ValueError(f"{key}: enter a number") from None
            if math.isnan(v) or v < 0:
                raise ValueError(f"{key}: price can't be negative")
            cap = PRICE_SCHEMA[section]["items"][key].get("max", 10_000_000)
            if v > cap:
                raise ValueError(f"{key}: must be at most {cap:g}")
            clean[section][key] = round(v, 2)
    return clean


def save_prices(db: Session, data: dict, org: str = DEFAULT_ORG, actor: str | None = None) -> dict:
    new = validate(data)
    old = get_prices(db, org)
    changes = [(s, k, old[s][k], v) for s, items in new.items() for k, v in items.items() if old[s][k] != v]
    if not changes:
        return new
    row = db.get(PriceList, org) or PriceList(organization_id=org)
    row.data, row.updated_by = new, actor
    db.add(row)
    for s, k, o, v in changes:
        db.add(PriceChange(organization_id=org, section=s, item=k, old_value=o, new_value=v, changed_by=actor))
    db.commit()
    return new


def history(db: Session, org: str = DEFAULT_ORG, limit: int = 50) -> list[dict]:
    rows = db.scalars(select(PriceChange).where(PriceChange.organization_id == org)
                      .order_by(PriceChange.id.desc()).limit(limit)).all()
    return [{"id": r.id, "section": r.section, "item": r.item, "old_value": r.old_value, "new_value": r.new_value,
             "changed_by": r.changed_by, "created_at": r.created_at.isoformat()} for r in rows]
