from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        store_dir=tmp_path / "store",
        samples_dir=tmp_path / "samples",
        db_path=tmp_path / "store" / "index.sqlite",
        max_upload_mb=5,
        cors_origins=["http://localhost:5173"],
    )


@pytest.fixture
def client(settings: Settings) -> TestClient:
    settings.samples_dir.mkdir(parents=True, exist_ok=True)
    return TestClient(create_app(settings))
