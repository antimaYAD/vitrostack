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

from .db import DEFAULT_ORG, AuthSession, SessionLocal, User, get_db, now

log = logging.getLogger("auth")
COOKIE = "vs_session"
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "0") == "1"
SESSION_HOURS = 12
REMEMBER_DAYS = 30
ROLES = ("admin", "estimator")
DEMO_MODE = os.getenv("DEMO_MODE", "1") == "1"
# Self-service sign-up creates a NEW company workspace; it never joins an existing one.
ALLOW_SIGNUP = os.getenv("ALLOW_SIGNUP", "1") == "1"
DEMO_ACCOUNTS = [
    {"name": "Admin", "email": "admin@vitrostack.local", "password": "admin123", "role": "admin"},
    {"name": "Estimator", "email": "estimator@vitrostack.local", "password": "estimator123", "role": "estimator"},
]
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
    _FAILS.pop(email, None)
    token = secrets.token_urlsafe(32)
    max_age = REMEMBER_DAYS * 86400 if remember else SESSION_HOURS * 3600
    db.add(AuthSession(token_hash=_hash_token(token), user_id=user.id,
                       expires_at=now() + timedelta(seconds=max_age), user_agent=(user_agent or "")[:300]))
    user.last_login_at = now()
    db.commit()
    return user, token, max_age


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
    return user


def require_admin(user: User = Depends(current_user)) -> User:
    if user.role != "admin":
        raise HTTPException(403, "Only admins can do this")
    return user


def public_user(u: User) -> dict:
    return {"id": u.id, "name": u.name, "email": u.email, "role": u.role, "active": u.active,
            "organization_id": u.organization_id, "must_change_password": u.must_change_password,
            "last_login_at": u.last_login_at.isoformat() if u.last_login_at else None,
            "created_at": u.created_at.isoformat() if u.created_at else None}


def seed_users():
    """First run: create the initial admin (ADMIN_EMAIL/ADMIN_PASSWORD) or the demo accounts."""
    db = SessionLocal()
    try:
        if db.scalar(select(func.count()).select_from(User)):
            return
        email, pw = os.getenv("ADMIN_EMAIL"), os.getenv("ADMIN_PASSWORD")
        if email and pw:
            db.add(User(organization_id=DEFAULT_ORG, name="Administrator", email=email.lower(),
                        password_hash=hash_password(pw), role="admin"))
            log.info("Created initial admin %s", email)
        else:
            for a in DEMO_ACCOUNTS:
                db.add(User(organization_id=DEFAULT_ORG, name=a["name"], email=a["email"],
                            password_hash=hash_password(a["password"]), role=a["role"]))
            log.warning("Created DEMO accounts (admin@vitrostack.local / admin123, estimator@vitrostack.local / "
                        "estimator123). Change these passwords or set ADMIN_EMAIL/ADMIN_PASSWORD before going live.")
        db.commit()
    finally:
        db.close()
