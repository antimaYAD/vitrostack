"""Sign-in, sign-out, current user and password change. There is no self-service sign-up."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import auth
from ..db import Organization, User, get_db

router = APIRouter(prefix="/api/v1/auth")


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)
    remember: bool = False


class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(max_length=200)


@router.get("/options")
def options():
    """Lets the login page show demo credentials only in demo mode."""
    return {"demo_accounts": [{k: a[k] for k in ("email", "password", "role")} for a in auth.DEMO_ACCOUNTS]
            if auth.DEMO_MODE else [], "allow_signup": False}


def _with_company(db: Session, user: User) -> dict:
    out = auth.public_user(user)
    org = db.get(Organization, user.organization_id)
    out["company_name"] = org.name if org else None
    return out


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    try:
        user, token, max_age = auth.login(db, body.email, body.password, body.remember, request.headers.get("user-agent"))
    except PermissionError as e:
        raise HTTPException(401, str(e)) from None
    response.set_cookie(auth.COOKIE, token, max_age=max_age, httponly=True, samesite="lax",
                        secure=auth.COOKIE_SECURE, path="/")
    return {"user": _with_company(db, user)}


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    auth.logout(db, request.cookies.get(auth.COOKIE))
    response.delete_cookie(auth.COOKIE, path="/")


@router.get("/me")
def me(db: Session = Depends(get_db), user: User = Depends(auth.current_user)):
    return {"user": _with_company(db, user)}


@router.post("/password")
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
    return {"user": _with_company(db, user)}
