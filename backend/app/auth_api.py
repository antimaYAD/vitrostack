from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import auth
from .db import AgentSession, User, get_db, uid

public = APIRouter(prefix="/api/v1/auth")
users = APIRouter(prefix="/api/v1/admin/users", dependencies=[Depends(auth.require_admin)])


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)
    remember: bool = False


class RegisterIn(BaseModel):
    company: str = Field(min_length=2, max_length=120)
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(max_length=200)
    remember: bool = True


class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(max_length=200)


class UserIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    role: str = "estimator"
    password: str | None = None


class UserPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    role: str | None = None
    active: bool | None = None


# ------------------------------------------------------------------ public auth

@public.get("/options")
def options():
    """Lets the login page show demo credentials only in demo mode."""
    return {"demo_accounts": [{k: a[k] for k in ("email", "password", "role")} for a in auth.DEMO_ACCOUNTS]
            if auth.DEMO_MODE else [], "allow_signup": auth.ALLOW_SIGNUP}


@public.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)):
    """Create a new company workspace; the person signing up becomes its first admin."""
    if not auth.ALLOW_SIGNUP:
        raise HTTPException(403, "Sign-up is disabled. Ask your admin for an account.")
    email = body.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise ValueError("Enter a valid email address")
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise ValueError("An account with this email already exists. Sign in instead.")
    auth.check_password_policy(body.password)
    org = f"org_{uid()}"
    db.add(User(organization_id=org, name=body.name.strip(), email=email,
                password_hash=auth.hash_password(body.password), role="admin"))
    db.commit()
    _, token, max_age = auth.login(db, email, body.password, body.remember, request.headers.get("user-agent"))
    response.set_cookie(auth.COOKIE, token, max_age=max_age, httponly=True, samesite="lax",
                        secure=auth.COOKIE_SECURE, path="/")
    user = db.scalar(select(User).where(User.email == email))
    return {"user": auth.public_user(user), "company": body.company.strip()}


@public.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    try:
        user, token, max_age = auth.login(db, body.email, body.password, body.remember, request.headers.get("user-agent"))
    except PermissionError as e:
        raise HTTPException(401, str(e)) from None
    response.set_cookie(auth.COOKIE, token, max_age=max_age, httponly=True, samesite="lax",
                        secure=auth.COOKIE_SECURE, path="/")
    return {"user": auth.public_user(user)}


@public.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    auth.logout(db, request.cookies.get(auth.COOKIE))
    response.delete_cookie(auth.COOKIE, path="/")


@public.get("/me")
def me(user: User = Depends(auth.current_user)):
    return {"user": auth.public_user(user)}


@public.post("/password")
def change_password(body: PasswordIn, request: Request, db: Session = Depends(get_db), user: User = Depends(auth.current_user)):
    if not auth.verify_password(body.current_password, user.password_hash):
        raise ValueError("Current password is incorrect")
    auth.check_password_policy(body.new_password)
    if body.new_password == body.current_password:
        raise ValueError("Choose a password different from the current one")
    user.password_hash = auth.hash_password(body.new_password)
    user.must_change_password = False
    db.commit()
    auth.revoke_all(db, user.id, except_token=request.cookies.get(auth.COOKIE))  # sign out other devices
    return {"user": auth.public_user(user)}


# ------------------------------------------------------------------ admin: user management

def _get(db: Session, uid: str, admin: User) -> User:
    u = db.get(User, uid)
    if not u or u.organization_id != admin.organization_id:
        raise HTTPException(404, "User not found")
    return u


def _active_admins(db: Session, org: str) -> int:
    return db.scalar(select(func.count()).select_from(User).where(
        User.organization_id == org, User.role == "admin", User.active.is_(True))) or 0


def _temp_password() -> str:
    return f"Vs-{secrets.token_urlsafe(6)}{secrets.randbelow(90) + 10}"


@users.get("")
def list_users(db: Session = Depends(get_db), admin: User = Depends(auth.require_admin)):
    rows = db.scalars(select(User).where(User.organization_id == admin.organization_id).order_by(User.created_at)).all()
    return [auth.public_user(u) for u in rows]


@users.post("", status_code=201)
def create_user(body: UserIn, db: Session = Depends(get_db), admin: User = Depends(auth.require_admin)):
    email = body.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise ValueError("Enter a valid email address")
    if body.role not in auth.ROLES:
        raise ValueError("Role must be admin or estimator")
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise ValueError("A user with this email already exists")
    pw = body.password or _temp_password()
    auth.check_password_policy(pw)
    u = User(organization_id=admin.organization_id, name=body.name.strip(), email=email,
             password_hash=auth.hash_password(pw), role=body.role, must_change_password=True)
    db.add(u)
    db.commit()
    return {"user": auth.public_user(u), "temporary_password": pw}


@users.patch("/{uid}")
def update_user(uid: str, body: UserPatch, db: Session = Depends(get_db), admin: User = Depends(auth.require_admin)):
    u = _get(db, uid, admin)
    losing_admin = (body.role is not None and body.role != "admin") or body.active is False
    if u.id == admin.id and losing_admin:
        raise ValueError("You can't remove your own admin access or deactivate yourself")
    if u.role == "admin" and u.active and losing_admin and _active_admins(db, admin.organization_id) <= 1:
        raise ValueError("At least one active admin is required")
    if body.role is not None:
        if body.role not in auth.ROLES:
            raise ValueError("Role must be admin or estimator")
        u.role = body.role
    if body.name is not None:
        u.name = body.name.strip()
    if body.active is not None:
        u.active = body.active
    db.commit()
    if body.active is False:
        auth.revoke_all(db, u.id)
    return {"user": auth.public_user(u)}


@users.post("/{uid}/reset-password")
def reset_password(uid: str, db: Session = Depends(get_db), admin: User = Depends(auth.require_admin)):
    u = _get(db, uid, admin)
    pw = _temp_password()
    u.password_hash = auth.hash_password(pw)
    u.must_change_password = True
    db.commit()
    auth.revoke_all(db, u.id)
    return {"user": auth.public_user(u), "temporary_password": pw}


@users.delete("/{uid}", status_code=204)
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
