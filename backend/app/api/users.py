"""Admin: user management within the signed-in admin's organisation."""
from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import auth
from ..db import AgentSession, User, get_db

router = APIRouter(prefix="/api/v1/admin/users", dependencies=[Depends(auth.require_admin)])


class UserIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    role: str = "estimator"
    password: str | None = None


class UserPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    email: str | None = Field(default=None, min_length=3, max_length=200)
    role: str | None = None
    active: bool | None = None


def _get(db: Session, uid: str, admin: User) -> User:
    u = db.get(User, uid)
    if not u or u.organization_id != admin.organization_id:
        raise HTTPException(404, "User not found")
    return u


def _active_admins(db: Session, org: str) -> int:
    return db.scalar(select(func.count()).select_from(User).where(
        User.organization_id == org, User.role == "admin", User.active.is_(True))) or 0


def checked_email(db: Session, email: str, exclude_id: str | None = None) -> str:
    """Normalise an email and make sure no other account uses it (emails are unique across all companies)."""
    email = email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise ValueError("Enter a valid email address")
    other = db.scalar(select(User).where(func.lower(User.email) == email))
    if other and other.id != exclude_id:
        raise ValueError("A user with this email already exists")
    return email


def _temp_password() -> str:
    return f"Vs-{secrets.token_urlsafe(6)}{secrets.randbelow(90) + 10}"


@router.get("")
def list_users(db: Session = Depends(get_db), admin: User = Depends(auth.require_admin)):
    rows = db.scalars(select(User).where(User.organization_id == admin.organization_id).order_by(User.created_at)).all()
    return [auth.public_user(u) for u in rows]


@router.post("", status_code=201)
def create_user(body: UserIn, db: Session = Depends(get_db), admin: User = Depends(auth.require_admin)):
    email = checked_email(db, body.email)
    if body.role not in auth.ROLES:
        raise ValueError("Role must be admin, estimator or architect")
    pw = body.password or _temp_password()
    auth.check_password_policy(pw)
    u = User(organization_id=admin.organization_id, name=body.name.strip(), email=email,
             password_hash=auth.hash_password(pw), role=body.role, must_change_password=True)
    db.add(u)
    db.commit()
    return {"user": auth.public_user(u), "temporary_password": pw}


@router.patch("/{uid}")
def update_user(uid: str, body: UserPatch, db: Session = Depends(get_db), admin: User = Depends(auth.require_admin)):
    u = _get(db, uid, admin)
    losing_admin = (body.role is not None and body.role != "admin") or body.active is False
    if u.id == admin.id and losing_admin:
        raise ValueError("You can't remove your own admin access or deactivate yourself")
    if u.role == "admin" and u.active and losing_admin and _active_admins(db, admin.organization_id) <= 1:
        raise ValueError("At least one active admin is required")
    if body.role is not None:
        if body.role not in auth.ROLES:
            raise ValueError("Role must be admin, estimator or architect")
        u.role = body.role
    if body.name is not None:
        u.name = body.name.strip()
    if body.email is not None:
        u.email = checked_email(db, body.email, exclude_id=u.id)
    if body.active is not None:
        u.active = body.active
    db.commit()
    if body.active is False:
        auth.revoke_all(db, u.id)
    return {"user": auth.public_user(u)}


@router.post("/{uid}/reset-password")
def reset_password(uid: str, db: Session = Depends(get_db), admin: User = Depends(auth.require_admin)):
    u = _get(db, uid, admin)
    pw = _temp_password()
    u.password_hash = auth.hash_password(pw)
    u.must_change_password = True
    db.commit()
    auth.revoke_all(db, u.id)
    return {"user": auth.public_user(u), "temporary_password": pw}


@router.delete("/{uid}", status_code=204)
def delete_user(uid: str, db: Session = Depends(get_db), admin: User = Depends(auth.require_admin)):
    u = _get(db, uid, admin)
    if u.id == admin.id:
        raise ValueError("You can't delete your own account")
    if u.role == "admin" and u.active and _active_admins(db, admin.organization_id) <= 1:
        raise ValueError("At least one active admin is required")
    for s in db.scalars(select(AgentSession).where(AgentSession.user_id == u.id)).all():
        s.user_id = None
    db.delete(u)
    db.commit()
