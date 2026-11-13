from __future__ import annotations

import re
import uuid
from pathlib import Path

from .services import STORAGE

UPLOADS = STORAGE / "uploads"
MAX_BYTES = 10 * 1024 * 1024


def save_upload(filename: str, content: bytes) -> str:
    if len(content) > MAX_BYTES:
        raise ValueError("File is larger than 10 MB")
    UPLOADS.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r"[^A-Za-z0-9._-]", "_", Path(filename).name)[-80:]
    file_id = f"{uuid.uuid4().hex[:10]}__{safe}"
    (UPLOADS / file_id).write_bytes(content)
    return file_id


def read_upload(file_id: str) -> tuple[str, bytes]:
    name = Path(file_id).name  # strips any path traversal
    path = UPLOADS / name
    if not path.is_file():
        raise ValueError(f"Upload {file_id} not found")
    return name.split("__", 1)[-1], path.read_bytes()
