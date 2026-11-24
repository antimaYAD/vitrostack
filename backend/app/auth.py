"""Authentication: PBKDF2 password hashing, opaque server-side sessions in an HttpOnly cookie, role checks."""
from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import time
from datetime import timedelta

from fastapi import Depends, HTTPException, Request
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .db import DEFAULT_ORG, PLATFORM_ORG, AuthSession, Organization, SessionLocal, User, get_db, now

log = logging.getLogger("auth")
COOKIE = "vs_session"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "0") == "1"
SESSION_HOURS = 12
REMEMBER_DAYS = 30
# Hierarchy: the superadmin (platform owner) creates companies and their admins; a company admin
# manages that company's estimators and architects. There is no self-service sign-up.
SUPERADMIN = "superadmin"
ROLES = ("admin", "estimator", "architect")  # roles a company admin can hand out
EDITOR_ROLES = ("admin", "estimator")  # may change projects, quote, use the copilot and site ops
DEMO_MODE = os.getenv("DEMO_MODE", "1") == "1"
DEMO_ACCOUNTS = [
    {"name": "Super Admin", "email": "superadmin@vitrostack.local", "password": "superadmin123", "role": SUPERADMIN},
    {"name": "Admin", "email": "admin@vitrostack.local", "password": "admin123", "role": "admin"},
    {"name": "Estimator", "email": "estimator@vitrostack.local", "password": "estimator123", "role": "estimator"},
    {"name": "Architect", "email": "architect@vitrostack.local", "password": "architect123", "role": "architect"},
]
SUSPENDED_MSG = "Your company's VitroStack access is suspended. Contact VitroStack support."
_ITER = 210_000


# ---------------------------------------------------------------- passwords

def hash_password(pw: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), salt, _ITER)
    return f"pbkdf2_sha256${_ITER}${salt.hex()}${dk.hex()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, iters, salt, digest = stored.split("$")
        dk = hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), int(iters))
        return hmac.compare_digest(dk.hex(), digest)
    except (ValueError, TypeError):
        return False


def check_password_policy(pw: str):
    if len(pw) < 8:
        raise ValueError("Password must be at least 8 characters")
    if pw.isdigit() or pw.isalpha():
        raise ValueError("Use a mix of letters and numbers")


# ---------------------------------------------------------------- brute-force throttle (per email, in-memory)

_FAILS: dict[str, list[float]] = {}
MAX_FAILS, WINDOW = 5, 15 * 60


def _throttled(email: str) -> bool:
    t = time.time()
    _FAILS[email] = [x for x in _FAILS.get(email, []) if t - x < WINDOW]
    return len(_FAILS[email]) >= MAX_FAILS


# ---------------------------------------------------------------- sessions

def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def login(db: Session, email: str, password: str, remember: bool, user_agent: str | None) -> tuple[User, str, int]:
    email = email.strip().lower()
    if _throttled(email):
        raise PermissionError("Too many attempts. Try again in 15 minutes.")
    user = db.scalar(select(User).where(func.lower(User.email) == email))
    if not user or not verify_password(password, user.password_hash):
        _FAILS.setdefault(email, []).append(time.time())
        raise PermissionError("Incorrect email or password")
    if not user.active:
        raise PermissionError("This account is deactivated. Ask your admin to re-enable it.")
    if company_suspended(db, user):
        raise PermissionError(SUSPENDED_MSG)
    _FAILS.pop(email, None)
    token = secrets.token_urlsafe(32)
    max_age = REMEMBER_DAYS * 86400 if remember else SESSION_HOURS * 3600
    db.add(AuthSession(token_hash=_hash_token(token), user_id=user.id,
                       expires_at=now() + timedelta(seconds=max_age), user_agent=(user_agent or "")[:300]))
    user.last_login_at = now()
    db.commit()
    return user, token, max_age


def company_suspended(db: Session, user: User) -> bool:
    if user.role == SUPERADMIN:
        return False
    org = db.get(Organization, user.organization_id)
    return bool(org and org.status == "suspended")


def logout(db: Session, token: str | None):
    if token:
        s = db.get(AuthSession, _hash_token(token))
        if s:
            db.delete(s)
            db.commit()


def revoke_all(db: Session, user_id: str, except_token: str | None = None):
    keep = _hash_token(except_token) if except_token else None
    for s in db.scalars(select(AuthSession).where(AuthSession.user_id == user_id)).all():
        if s.token_hash != keep:
            db.delete(s)
    db.commit()


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE)
    if not token:
        raise HTTPException(401, "Please sign in")
    s = db.get(AuthSession, _hash_token(token))
    if not s or s.expires_at < now():
        if s:
            db.delete(s)
            db.commit()
        raise HTTPException(401, "Your session expired. Please sign in again.")
    user = db.get(User, s.user_id)
    if not user or not user.active:
        raise HTTPException(401, "Please sign in")
    if company_suspended(db, user):
        raise HTTPException(401, SUSPENDED_MSG)
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Only admins can do this")
    return user


def require_editor(user: User = Depends(current_user)) -> User:
    """Admins and estimators. Architects get read-only project access."""
    if user.role not in EDITOR_ROLES:
        raise HTTPException(403, "Your role has view-only access to this")
    return user


def require_superadmin(user: User = Depends(current_user)) -> User:
    if user.role != SUPERADMIN:
        raise HTTPException(403, "Only the VitroStack superadmin can do this")
    return user


def sees_costs(user: User) -> bool:
    return user.role in EDITOR_ROLES


def public_user(u: User) -> dict:
    return {"id": u.id, "name": u.name, "email": u.email, "role": u.role, "active": u.active,
            "organization_id": u.organization_id, "must_change_password": u.must_change_password,
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            "created_at": u.created_at.isoformat() if u.created_at else None}


def seed_users():
    """Idempotent start-up seeding.

    - First run: the initial company admin (ADMIN_EMAIL/ADMIN_PASSWORD) or the demo accounts.
    - Every organization_id that users belong to gets an Organization row (upgrades older databases).
    - SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD creates the platform superadmin if that email is not taken.
    """
    db = SessionLocal()
    try:
        if not db.scalar(select(func.count()).select_from(User)):
            email, pw = os.getenv("ADMIN_EMAIL"), os.getenv("ADMIN_PASSWORD")
            if email and pw:
                db.add(User(organization_id=DEFAULT_ORG, name="Administrator", email=email.lower(),
                            password_hash=hash_password(pw), role="admin"))
                log.info("Created initial admin %s", email)
            else:
                for a in DEMO_ACCOUNTS:
                    if a["role"] == SUPERADMIN and not DEMO_MODE:
                        continue  # never a well-known superadmin password outside demo mode
                    db.add(User(organization_id=PLATFORM_ORG if a["role"] == SUPERADMIN else DEFAULT_ORG,
                                name=a["name"], email=a["email"], password_hash=hash_password(a["password"]),
                                role=a["role"]))
                log.warning("Created DEMO accounts (see DEMO_ACCOUNTS). Change these passwords or set "
                            "ADMIN_EMAIL/ADMIN_PASSWORD and SUPERADMIN_EMAIL/SUPERADMIN_PASSWORD before going live.")
            db.flush()
        for oid in db.scalars(select(User.organization_id).distinct()).all():
            if oid != PLATFORM_ORG and not db.get(Organization, oid):
                name = os.getenv("COMPANY_NAME", "VitroStack Demo") if oid == DEFAULT_ORG else f"Company {oid[-6:]}"
                db.add(Organization(id=oid, name=name))
        email, pw = os.getenv("SUPERADMIN_EMAIL"), os.getenv("SUPERADMIN_PASSWORD")
        if email and pw:
            existing = db.scalar(select(User).where(func.lower(User.email) == email.strip().lower()))
            if not existing:
                db.add(User(organization_id=PLATFORM_ORG, name="Super Admin", email=email.strip().lower(),
                            password_hash=hash_password(pw), role=SUPERADMIN))
                log.info("Created superadmin %s", email)
            elif existing.role != SUPERADMIN:
                log.warning("SUPERADMIN_EMAIL %s already belongs to a company user; superadmin not created", email)
        db.commit()
    finally:
        db.close()
