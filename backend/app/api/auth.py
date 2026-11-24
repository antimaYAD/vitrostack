"""Sign-in, sign-up, sign-out, current user and password change."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .. import auth
from ..db import DEFAULT_ORG, User, get_db

router = APIRouter(prefix="/api/v1/auth")


class LoginIn(BaseModel):
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(min_length=1, max_length=200)
    remember: bool = False


class RegisterIn(BaseModel):
    company: str = Field(default="", max_length=120)  # ignored; kept so older clients still work
    name: str = Field(min_length=1, max_length=120)
    email: str = Field(min_length=3, max_length=200)
    password: str = Field(max_length=200)
    remember: bool = True


class PasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(max_length=200)


@router.get("/options")
def options():
    """Lets the login page show demo credentials only in demo mode."""
    return {"demo_accounts": [{k: a[k] for k in ("email", "password", "role")} for a in auth.DEMO_ACCOUNTS]
            if auth.DEMO_MODE else [], "allow_signup": auth.ALLOW_SIGNUP}


@router.post("/register", status_code=201)
def register(body: RegisterIn, request: Request, response: Response, db: Session = Depends(get_db)):
    """Self sign-up: joins the company workspace as an estimator. Only an admin can grant admin rights."""
    if not auth.ALLOW_SIGNUP:
        raise HTTPException(403, "Sign-up is disabled. Ask your admin for an account.")
    email = body.email.strip().lower()
    if "@" not in email or "." not in email.split("@")[-1]:
        raise ValueError("Enter a valid email address")
    if db.scalar(select(User).where(func.lower(User.email) == email)):
        raise ValueError("An account with this email already exists. Sign in instead.")
    auth.check_password_policy(body.password)
    db.add(User(organization_id=DEFAULT_ORG, name=body.name.strip(), email=email,
                password_hash=auth.hash_password(body.password), role="estimator"))
    db.commit()
    _, token, max_age = auth.login(db, email, body.password, body.remember, request.headers.get("user-agent"))
    response.set_cookie(auth.COOKIE, token, max_age=max_age, httponly=True, samesite="lax",
                        secure=auth.COOKIE_SECURE, path="/")
    user = db.scalar(select(User).where(User.email == email))
    return {"user": auth.public_user(user)}


@router.post("/login")
def login(body: LoginIn, request: Request, response: Response, db: Session = Depends(get_db)):
    try:
        user, token, max_age = auth.login(db, body.email, body.password, body.remember, request.headers.get("user-agent"))
    except PermissionError as e:
        raise HTTPException(401, str(e)) from None
    response.set_cookie(auth.COOKIE, token, max_age=max_age, httponly=True, samesite="lax",
                        secure=auth.COOKIE_SECURE, path="/")
    return {"user": auth.public_user(user)}


@router.post("/logout", status_code=204)
def logout(request: Request, response: Response, db: Session = Depends(get_db)):
    auth.logout(db, request.cookies.get(auth.COOKIE))
    response.delete_cookie(auth.COOKIE, path="/")


@router.get("/me")
def me(user: User = Depends(auth.current_user)):
    return {"user": auth.public_user(user)}


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
    return {"user": auth.public_user(user)}
