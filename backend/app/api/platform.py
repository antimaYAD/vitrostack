"""Superadmin: companies (tenants) and their admins.

The superadmin sees each company's name, status, user and project counts, and its admins.
It never reads a company's projects, prices or offcuts.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import auth
from ..db import Organization, Project, User, get_db, uid
from .users import _temp_password

router = APIRouter(prefix="/api/v1/platform", dependencies=[Depends(auth.require_superadmin)])


class CompanyIn(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    admin_name: str = Field(min_length=1, max_length=120)
    admin_email: str = Field(min_length=3, max_length=200)


class CompanyPatch(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=160)
    status: str | None = None


class AdminIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200)


def _clean_email(db: Session, email: str) -> str:
    email = email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise ValueError("Enter a valid email address")
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise ValueError("A user with this email already exists")
    return email


def _new_admin(db: Session, org: str, name: str, email: str) -> tuple[User, str]:
    pw = _temp_password()
    u = User(organization_id=org, name=name.strip(), email=_clean_email(db, email),
             password_hash=auth.hash_password(pw), role="admin", must_change_password=True)
    db.add(u)
    return u, pw


def _company(db: Session, o: Organization) -> dict:
    users = db.scalars(select(User).where(User.organization_id == o.id).order_by(User.created_at)).all()
    projects = db.scalar(select(func.count()).select_from(Project).where(Project.organization_id == o.id)) or 0
    roles = {r: sum(1 for u in users if u.role == r) for r in auth.ROLES}
    return {
        "id": o.id, "name": o.name, "status": o.status,
        "created_at": o.created_at.isoformat() if o.created_at else None,
        "user_count": len(users), "project_count": projects, "roles": roles,
        "admins": [{"id": u.id, "name": u.name, "email": u.email, "active": u.active,
                    "must_change_password": u.must_change_password,
                    "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None}
                   for u in users if u.role == "admin"],
    }


def _get(db: Session, cid: str) -> Organization:
    o = db.get(Organization, cid)
    if not o:
        raise HTTPException(404, "Company not found")
    return o


@router.get("/companies")
def list_companies(db: Session = Depends(get_db)):
    return [_company(db, o) for o in db.scalars(select(Organization).order_by(Organization.created_at)).all()]


@router.post("/companies", status_code=201)
def create_company(body: CompanyIn, db: Session = Depends(get_db)):
    name = body.name.strip()
    if db.scalar(select(Organization).where(func.lower(Organization.name) == name.lower())):
        raise ValueError("A company with this name already exists")
    o = Organization(id=f"org_{uid()}", name=name)
    db.add(o)
    admin, pw = _new_admin(db, o.id, body.admin_name, body.admin_email)
    db.commit()
    return {"company": _company(db, o), "admin_email": admin.email, "temporary_password": pw}


@router.patch("/companies/{cid}")
def update_company(cid: str, body: CompanyPatch, db: Session = Depends(get_db)):
    o = _get(db, cid)
    if body.name is not None:
        o.name = body.name.strip()
    if body.status is not None:
        if body.status not in ("active", "suspended"):
            raise ValueError("Status must be active or suspended")
        o.status = body.status
    db.commit()
    if body.status == "suspended":  # sign everyone in that company out now
        for u in db.scalars(select(User).where(User.organization_id == o.id)).all():
            auth.revoke_all(db, u.id)
    return _company(db, o)


@router.post("/companies/{cid}/admins", status_code=201)
def add_admin(cid: str, body: AdminIn, db: Session = Depends(get_db)):
    o = _get(db, cid)
    admin, pw = _new_admin(db, o.id, body.name, body.email)
    db.commit()
    return {"company": _company(db, o), "admin_email": admin.email, "temporary_password": pw}


@router.post("/admins/{user_id}/reset-password")
def reset_admin_password(user_id: str, db: Session = Depends(get_db)):
    u = db.get(User, user_id)
    if not u or u.role != "admin":
        raise HTTPException(404, "Company admin not found")
    pw = _temp_password()
    u.password_hash = auth.hash_password(pw)
    u.must_change_password = True
    u.active = True
    db.commit()
    auth.revoke_all(db, u.id)
    return {"admin_email": u.email, "temporary_password": pw}
