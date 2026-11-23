"""Vercel serverless entry point: runs the FastAPI backend for every /api/* request."""
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
# Vercel's filesystem is read-only except /tmp; PDFs and uploads go there (they don't survive between instances).
os.environ.setdefault("VITRO_STORAGE", "/tmp/vitrostack")

from app.main import app, startup  # noqa: E402

startup()  # don't depend on ASGI lifespan events in the serverless runtime

__all__ = ["app"]
