from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]


@dataclass(frozen=True)
class Settings:
    store_dir: Path
    samples_dir: Path
    db_path: Path
    max_upload_mb: int
    cors_origins: list[str]


def get_settings() -> Settings:
    data = REPO_ROOT / "data"
    store_dir = Path(os.environ.get("STORE_DIR", data / "store"))
    return Settings(
        store_dir=store_dir,
        samples_dir=Path(os.environ.get("SAMPLES_DIR", data / "samples")),
        db_path=Path(os.environ.get("DB_PATH", store_dir / "index.sqlite")),
        max_upload_mb=int(os.environ.get("MAX_UPLOAD_MB", "500")),
        cors_origins=[
            o.strip()
            for o in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")
            if o.strip()
        ],
    )
