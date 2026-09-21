from pathlib import Path

from app.config import Settings, get_settings
from app.db import connect, init_schema


def test_get_settings_reads_env(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("STORE_DIR", str(tmp_path / "store"))
    monkeypatch.setenv("SAMPLES_DIR", str(tmp_path / "samples"))
    monkeypatch.setenv("DB_PATH", str(tmp_path / "idx.sqlite"))
    monkeypatch.setenv("MAX_UPLOAD_MB", "7")
    monkeypatch.setenv("CORS_ORIGINS", "http://a:1,http://b:2")
    s = get_settings()
    assert s == Settings(
        store_dir=tmp_path / "store",
        samples_dir=tmp_path / "samples",
        db_path=tmp_path / "idx.sqlite",
        max_upload_mb=7,
        cors_origins=["http://a:1", "http://b:2"],
    )


def test_get_settings_defaults(monkeypatch) -> None:
    for k in ("STORE_DIR", "SAMPLES_DIR", "DB_PATH", "MAX_UPLOAD_MB", "CORS_ORIGINS"):
        monkeypatch.delenv(k, raising=False)
    s = get_settings()
    assert s.max_upload_mb == 500
    assert s.cors_origins == ["http://localhost:5173"]
    assert s.store_dir.name == "store" and s.samples_dir.name == "samples"


def test_init_schema_creates_tables(tmp_path: Path) -> None:
    conn = connect(tmp_path / "x.sqlite")
    init_schema(conn)
    names = {r[0] for r in conn.execute("SELECT name FROM sqlite_master WHERE type='table'")}
    assert {"study", "series", "instance"} <= names
    init_schema(conn)  # idempotent


def test_health(client) -> None:
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
