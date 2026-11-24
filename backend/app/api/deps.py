"""Shared dependencies for the API modules."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from .. import auth
from ..db import User


def protected_router() -> APIRouter:
    """A /api/v1 router where every route requires a signed-in user."""
    return APIRouter(prefix="/api/v1", dependencies=[Depends(auth.current_user)])


def org_id(user: User = Depends(auth.current_user)) -> str:
    """Tenant scoping comes from the signed-in user, never from a client-supplied header."""
    if user.role == auth.SUPERADMIN:
        raise HTTPException(403, "The superadmin manages companies and has no company workspace of its own")
    return user.organization_id


editor = Depends(auth.require_editor)  # admins and estimators only; architects are read-only
