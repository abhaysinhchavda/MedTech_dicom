# DICOM 3D Web Viewer — Backend Implementation Plan (Part 1 of 2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A FastAPI service that ingests DICOM studies (bundled or uploaded), validates each series as a 3D volume, and serves them through a conformant DICOMweb subset (QIDO-RS + WADO-RS) plus a small custom API.

**Architecture:** Pure-function ingest pipeline (read → decode → file → index → finalize) writing to a SQLite index and a UID-hierarchy file store; thin FastAPI routers over a `repo.py` query layer. Pixel data is decoded once at ingest so `frames/{n}` is a byte slice.

**Tech Stack:** Python 3.12, FastAPI 0.141, pydicom 3.0, pylibjpeg (openjpeg + rle + libjpeg), numpy 2, Pillow, python-multipart, pytest 9, httpx, ruff, mypy. Plain `venv` + `pip` (uv is not installed on this machine).

**Spec:** `docs/superpowers/specs/2026-09-21-dicom-web-viewer-design.md` (§4, §6-backend, §7, §8). Read it first.

**Companion plan:** `docs/superpowers/plans/2026-09-21-dicom-viewer-frontend.md` (Part 2) consumes the HTTP interfaces this plan produces.

## Global Constraints

- Python **3.12**; all code type-annotated; `mypy app/` and `ruff check .` must pass at the end of every task.
- No ORM: `sqlite3` only. No test touches the network or `data/samples/`.
- Stored files are always **Explicit VR Little Endian** (`1.2.840.10008.1.2.1`).
- JSON responses from `/dicomweb/*` use media type `application/dicom+json`.
- Frame responses are `multipart/related; type="application/octet-stream"`.
- `MAX_UPLOAD_MB` default **500**. CORS restricted to `CORS_ORIGINS` (default `http://localhost:5173`).
- **Git:** the user initialises the repository themselves. This plan has **no commit steps**; each task ends with the test run instead.
- Run all commands from `D:\Cluade_WS\Medical_Project\backend` unless stated otherwise. Shell is PowerShell.

## File structure

```
backend/
├── pyproject.toml
├── app/
│   ├── __init__.py
│   ├── main.py            create_app(settings) ; lifespan ingests SAMPLES_DIR
│   ├── config.py          Settings dataclass + get_settings()
│   ├── db.py              connect(), init_schema()
│   ├── models.py          InstanceRow, SeriesRow, StudyRow, VolumeInfo, SkippedFile, IngestSummary
│   ├── repo.py            upsert/select helpers over the three tables (not in spec; needed by routers + indexer)
│   ├── geometry.py        sort_instances(), volume_info()
│   ├── ingest/
│   │   ├── __init__.py
│   │   ├── reader.py      NotDicomError, read_dicom()
│   │   ├── decode.py      DecodeError, to_uncompressed()
│   │   ├── store.py       file_instance()
│   │   └── indexer.py     instance_row_from_dataset(), index_instance(), finalize_series(), ingest_directory()
│   ├── dicomweb/
│   │   ├── __init__.py
│   │   ├── json_model.py  dataset_to_dicom_json()
│   │   ├── multipart.py   multipart_related()  (shared by frames + instance)
│   │   ├── qido.py        router
│   │   └── wado.py        router
│   └── api/
│       ├── __init__.py
│       ├── health.py      router
│       ├── volume.py      router
│       └── upload.py      router
└── tests/
    ├── conftest.py        make_ct_series(), write_series(), settings/client fixtures
    ├── test_config_db.py
    ├── test_reader.py
    ├── test_decode.py
    ├── test_store.py
    ├── test_geometry.py
    ├── test_json_model.py
    ├── test_indexer.py
    ├── test_qido.py
    ├── test_wado.py
    ├── test_volume_api.py
    ├── test_upload.py
    └── test_main.py
```

---

### Task 1: Project scaffold, settings, database schema, health endpoint

**Files:**
- Create: `backend/pyproject.toml`, `backend/app/__init__.py`, `backend/app/config.py`, `backend/app/db.py`, `backend/app/api/__init__.py`, `backend/app/api/health.py`, `backend/app/main.py` (minimal; extended in Task 13), `backend/tests/conftest.py` (minimal; extended in Task 2), `backend/tests/test_config_db.py`
- Create: `.gitignore` (repo root)

**Interfaces:**
- Produces: `Settings(store_dir: Path, samples_dir: Path, db_path: Path, max_upload_mb: int, cors_origins: list[str])`; `get_settings() -> Settings`; `connect(db_path: Path) -> sqlite3.Connection`; `init_schema(conn) -> None`; `create_app(settings: Settings | None = None) -> FastAPI`; `GET /api/health -> {"status": "ok"}`.

- [ ] **Step 1: Create the virtualenv and `pyproject.toml`**

```powershell
New-Item -ItemType Directory -Force D:\Cluade_WS\Medical_Project\backend | Out-Null
Set-Location D:\Cluade_WS\Medical_Project\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
```

`backend/pyproject.toml`:

```toml
[project]
name = "dicom-viewer-backend"
version = "0.1.0"
description = "DICOMweb (QIDO-RS/WADO-RS) server for the DICOM 3D Web Viewer"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.141,<1",
  "uvicorn[standard]>=0.53",
  "pydicom>=3.0,<4",
  "pylibjpeg>=2.1",
  "pylibjpeg-openjpeg>=2.0",
  "pylibjpeg-rle>=2.0",
  "pylibjpeg-libjpeg>=2.0",
  "numpy>=2.0",
  "pillow>=11",
  "python-multipart>=0.0.20",
]

[project.optional-dependencies]
dev = ["pytest>=9", "httpx>=0.28", "ruff>=0.16", "mypy>=2.0"]

[build-system]
requires = ["setuptools>=69"]
build-backend = "setuptools.build_meta"

[tool.setuptools.packages.find]
include = ["app*"]

[tool.pytest.ini_options]
testpaths = ["tests"]

[tool.ruff]
line-length = 100
target-version = "py312"

[tool.ruff.lint]
select = ["E", "F", "I", "UP", "B"]

[tool.mypy]
python_version = "3.12"
strict = true
ignore_missing_imports = true
```

```powershell
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
```

Expected: install succeeds; `python -c "import pydicom, fastapi; print(pydicom.__version__)"` prints `3.0.x`.

- [ ] **Step 2: Write the failing tests for settings and schema**

`backend/tests/test_config_db.py`:

```python
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
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest tests/test_config_db.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app'`.

- [ ] **Step 4: Implement `config.py`, `db.py`, `health.py`, minimal `main.py`**

`backend/app/__init__.py`: empty file. `backend/app/api/__init__.py`: empty file.

`backend/app/config.py`:

```python
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
```

`backend/app/db.py`:

```python
from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS study (
  study_uid TEXT PRIMARY KEY,
  patient_name TEXT, patient_id TEXT, study_date TEXT, study_time TEXT,
  study_desc TEXT, accession TEXT, modalities TEXT
);
CREATE TABLE IF NOT EXISTS series (
  series_uid TEXT PRIMARY KEY,
  study_uid TEXT NOT NULL REFERENCES study(study_uid),
  modality TEXT, series_desc TEXT, series_number INTEGER,
  instance_count INTEGER DEFAULT 0, thumb_sop_uid TEXT, sort_method TEXT,
  is_volume INTEGER DEFAULT 0, volume_reason TEXT,
  dim_x INTEGER, dim_y INTEGER, dim_z INTEGER,
  spacing_x REAL, spacing_y REAL, spacing_z REAL,
  origin_x REAL, origin_y REAL, origin_z REAL, direction TEXT
);
CREATE TABLE IF NOT EXISTS instance (
  sop_uid TEXT PRIMARY KEY,
  series_uid TEXT NOT NULL REFERENCES series(series_uid),
  instance_number INTEGER, rows INTEGER, cols INTEGER,
  bits_allocated INTEGER, pixel_representation INTEGER, samples_per_pixel INTEGER,
  num_frames INTEGER,
  ipp_x REAL, ipp_y REAL, ipp_z REAL, iop TEXT, pixel_spacing TEXT,
  path TEXT NOT NULL, transfer_syntax TEXT
);
CREATE INDEX IF NOT EXISTS ix_series_study ON series(study_uid);
CREATE INDEX IF NOT EXISTS ix_instance_series ON instance(series_uid);
"""


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()
```

`backend/app/api/health.py`:

```python
from fastapi import APIRouter

router = APIRouter(prefix="/api", tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
```

`backend/app/main.py` (minimal; Task 13 adds lifespan ingest and the other routers):

```python
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health
from app.config import Settings, get_settings
from app.db import connect, init_schema


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="DICOM 3D Web Viewer API")
    app.state.settings = settings
    conn = connect(settings.db_path)
    init_schema(conn)
    app.state.db = conn
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Sort-Method", "Content-Length"],
    )
    app.include_router(health.router)
    return app


app = create_app()
```

`backend/tests/conftest.py` (minimal; Task 2 extends it):

```python
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
```

Add to `backend/tests/test_config_db.py`:

```python
def test_health(client) -> None:
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
```

Repo-root `.gitignore`:

```
.venv/
__pycache__/
*.pyc
.pytest_cache/
.mypy_cache/
.ruff_cache/
data/samples/
data/store/
node_modules/
frontend/dist/
frontend/playwright-report/
frontend/test-results/
.env
```

- [ ] **Step 5: Run tests and linters**

Run: `python -m pytest tests/test_config_db.py -v; ruff check .; mypy app/`
Expected: 4 passed; ruff and mypy clean.

---

### Task 2: Synthetic DICOM fixtures and `reader.py`

**Files:**
- Modify: `backend/tests/conftest.py`
- Create: `backend/app/ingest/__init__.py`, `backend/app/ingest/reader.py`, `backend/tests/test_reader.py`

**Interfaces:**
- Produces (tests): `make_ct_series(n, *, spacing=(0.5, 0.5, 1.0), orientation="axial", transfer_syntax=ExplicitVRLittleEndian, irregular=False, mixed_orientation=False, rows=16, cols=16, study_uid=None, series_uid=None, modality="CT") -> list[Dataset]`; `write_series(datasets, directory) -> list[Path]`.
- Produces: `class NotDicomError(Exception)`; `read_dicom(path: Path) -> pydicom.Dataset`.

- [ ] **Step 1: Extend `conftest.py` with the fixture factory**

Append to `backend/tests/conftest.py`:

```python
import numpy as np
import pydicom
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

ORIENTATIONS = {
    "axial": [1, 0, 0, 0, 1, 0],
    "coronal": [1, 0, 0, 0, 0, -1],
    "sagittal": [0, 1, 0, 0, 0, -1],
}


def make_ct_series(
    n: int,
    *,
    spacing: tuple[float, float, float] = (0.5, 0.5, 1.0),
    orientation: str = "axial",
    transfer_syntax: str = ExplicitVRLittleEndian,
    irregular: bool = False,
    mixed_orientation: bool = False,
    rows: int = 16,
    cols: int = 16,
    study_uid: str | None = None,
    series_uid: str | None = None,
    modality: str = "CT",
) -> list[Dataset]:
    study_uid = study_uid or generate_uid()
    series_uid = series_uid or generate_uid()
    iop = ORIENTATIONS[orientation]
    normal = np.cross(iop[:3], iop[3:])
    out: list[Dataset] = []
    for i in range(n):
        ds = Dataset()
        ds.file_meta = FileMetaDataset()
        ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
        ds.file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
        ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
        ds.SOPClassUID = ds.file_meta.MediaStorageSOPClassUID
        ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
        ds.StudyInstanceUID = study_uid
        ds.SeriesInstanceUID = series_uid
        ds.PatientName = "Test^Patient"
        ds.PatientID = "P001"
        ds.StudyDate = "20240101"
        ds.StudyTime = "120000"
        ds.StudyDescription = "Synthetic study"
        ds.SeriesDescription = "Synthetic series"
        ds.AccessionNumber = "ACC1"
        ds.Modality = modality
        ds.SeriesNumber = 1
        ds.InstanceNumber = i + 1
        ds.Rows, ds.Columns = rows, cols
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.BitsAllocated, ds.BitsStored, ds.HighBit = 16, 16, 15
        ds.PixelRepresentation = 1
        ds.RescaleIntercept, ds.RescaleSlope = -1024, 1
        ds.WindowCenter, ds.WindowWidth = 40, 400
        ds.PixelSpacing = [spacing[0], spacing[1]]
        ds.SliceThickness = spacing[2]
        z = i * spacing[2] + (spacing[2] * 0.5 if irregular and i == n // 2 else 0.0)
        ds.ImagePositionPatient = [float(v) for v in normal * z]
        ds.ImageOrientationPatient = (
            ORIENTATIONS["coronal"] if mixed_orientation and i == n - 1 else iop
        )
        rng = np.random.default_rng(i)
        ds.PixelData = rng.integers(-1000, 2000, size=(rows, cols), dtype=np.int16).tobytes()
        ds.is_little_endian = True
        ds.is_implicit_VR = False
        if transfer_syntax != ExplicitVRLittleEndian:
            ds.compress(transfer_syntax)
        out.append(ds)
    return out


def write_series(datasets: list[Dataset], directory: Path) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    paths = []
    for k, ds in enumerate(datasets):
        p = directory / f"img{k:04d}.dcm"
        pydicom.dcmwrite(p, ds, enforce_file_format=True)
        paths.append(p)
    return paths
```

- [ ] **Step 2: Write the failing reader tests**

`backend/tests/test_reader.py`:

```python
from pathlib import Path

import pydicom
import pytest

from app.ingest.reader import NotDicomError, read_dicom
from tests.conftest import make_ct_series, write_series


def test_reads_valid_file(tmp_path: Path) -> None:
    (p,) = write_series(make_ct_series(1), tmp_path)
    ds = read_dicom(p)
    assert ds.SOPInstanceUID and ds.pixel_array.shape == (16, 16)


def test_rejects_non_dicom(tmp_path: Path) -> None:
    p = tmp_path / "junk.txt"
    p.write_bytes(b"hello world" * 100)
    with pytest.raises(NotDicomError):
        read_dicom(p)


def test_rejects_object_without_pixel_data(tmp_path: Path) -> None:
    (ds,) = make_ct_series(1)
    del ds.PixelData
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.88.11"  # Basic Text SR
    p = tmp_path / "sr.dcm"
    pydicom.dcmwrite(p, ds, enforce_file_format=True)
    with pytest.raises(NotDicomError, match="PixelData"):
        read_dicom(p)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest tests/test_reader.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.ingest'`.

- [ ] **Step 4: Implement `reader.py`**

`backend/app/ingest/__init__.py`: empty. `backend/app/ingest/reader.py`:

```python
from __future__ import annotations

from pathlib import Path

import pydicom
from pydicom.dataset import Dataset
from pydicom.errors import InvalidDicomError

REQUIRED = ("SOPInstanceUID", "SeriesInstanceUID", "StudyInstanceUID", "PixelData")


class NotDicomError(Exception):
    """File is not a DICOM image object we can serve."""


def read_dicom(path: Path) -> Dataset:
    try:
        ds = pydicom.dcmread(path, force=False)
    except (InvalidDicomError, OSError, ValueError) as e:
        raise NotDicomError(f"{path.name}: not a DICOM file ({e})") from e
    for tag in REQUIRED:
        if tag not in ds:
            raise NotDicomError(f"{path.name}: missing {tag}")
    return ds
```

- [ ] **Step 5: Run tests and linters**

Run: `python -m pytest tests/test_reader.py -v; ruff check .; mypy app/`
Expected: 3 passed; clean.

---

### Task 3: `decode.py` — normalise to Explicit VR Little Endian

**Files:**
- Create: `backend/app/ingest/decode.py`, `backend/tests/test_decode.py`

**Interfaces:**
- Produces: `class DecodeError(Exception)`; `to_uncompressed(ds: Dataset) -> Dataset` (mutates and returns the same dataset).

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_decode.py`:

```python
import numpy as np
import pytest
from pydicom.uid import ExplicitVRLittleEndian, JPEG2000Lossless, RLELossless

from app.ingest.decode import DecodeError, to_uncompressed
from tests.conftest import make_ct_series


@pytest.mark.parametrize("ts", [JPEG2000Lossless, RLELossless])
def test_compressed_roundtrips_to_explicit_le(ts: str) -> None:
    (ds,) = make_ct_series(1, transfer_syntax=ts)
    expected = ds.pixel_array.copy()
    assert ds.file_meta.TransferSyntaxUID.is_compressed
    out = to_uncompressed(ds)
    assert out.file_meta.TransferSyntaxUID == ExplicitVRLittleEndian
    assert not out.file_meta.TransferSyntaxUID.is_compressed
    assert np.array_equal(out.pixel_array, expected)
    assert len(out.PixelData) == 16 * 16 * 2


def test_uncompressed_passthrough() -> None:
    (ds,) = make_ct_series(1)
    raw = bytes(ds.PixelData)
    out = to_uncompressed(ds)
    assert out is ds and bytes(out.PixelData) == raw


def test_decode_failure_raises() -> None:
    (ds,) = make_ct_series(1, transfer_syntax=RLELossless)
    ds.PixelData = b"\x00" * 10  # corrupt encapsulated data
    with pytest.raises(DecodeError):
        to_uncompressed(ds)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_decode.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.ingest.decode'`.

- [ ] **Step 3: Implement `decode.py`**

```python
from __future__ import annotations

from pydicom.dataset import Dataset
from pydicom.uid import ExplicitVRLittleEndian


class DecodeError(Exception):
    """Pixel data could not be decoded to native little-endian."""


def to_uncompressed(ds: Dataset) -> Dataset:
    ts = ds.file_meta.TransferSyntaxUID
    if not ts.is_compressed:
        if ts != ExplicitVRLittleEndian:
            ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
        return ds
    try:
        ds.decompress()
    except Exception as e:  # pylibjpeg raises a zoo of exception types
        raise DecodeError(f"cannot decode transfer syntax {ts.name}: {e}") from e
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    return ds
```

- [ ] **Step 4: Run tests and linters**

Run: `python -m pytest tests/test_decode.py -v; ruff check .; mypy app/`
Expected: 4 passed; clean. (If `ds.decompress()` with `RLELossless` corrupt data raises nothing, tighten the test data to `b""`.)

---

### Task 4: `store.py` — file by UID hierarchy

**Files:**
- Create: `backend/app/ingest/store.py`, `backend/tests/test_store.py`

**Interfaces:**
- Produces: `file_instance(ds: Dataset, store_dir: Path) -> Path`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_store.py`:

```python
from pathlib import Path

import pydicom

from app.ingest.store import file_instance
from tests.conftest import make_ct_series


def test_files_by_uid_hierarchy(tmp_path: Path) -> None:
    (ds,) = make_ct_series(1)
    p = file_instance(ds, tmp_path)
    assert p == tmp_path / ds.StudyInstanceUID / ds.SeriesInstanceUID / f"{ds.SOPInstanceUID}.dcm"
    assert pydicom.dcmread(p).SOPInstanceUID == ds.SOPInstanceUID


def test_overwrite_is_idempotent(tmp_path: Path) -> None:
    (ds,) = make_ct_series(1)
    p1 = file_instance(ds, tmp_path)
    p2 = file_instance(ds, tmp_path)
    assert p1 == p2 and len(list(p1.parent.iterdir())) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_store.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement `store.py`**

```python
from __future__ import annotations

from pathlib import Path

import pydicom
from pydicom.dataset import Dataset


def file_instance(ds: Dataset, store_dir: Path) -> Path:
    dest = store_dir / ds.StudyInstanceUID / ds.SeriesInstanceUID / f"{ds.SOPInstanceUID}.dcm"
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp")
    pydicom.dcmwrite(tmp, ds, enforce_file_format=True)
    tmp.replace(dest)
    return dest
```

- [ ] **Step 4: Run tests and linters**

Run: `python -m pytest tests/test_store.py -v; ruff check .; mypy app/`
Expected: 2 passed; clean.

---

### Task 5: `models.py` and `geometry.py` — slice ordering and volume validation

**Files:**
- Create: `backend/app/models.py`, `backend/app/geometry.py`, `backend/tests/test_geometry.py`

**Interfaces:**
- Produces (models): dataclasses below — used verbatim by every later task.
- Produces (geometry): `SortMethod = Literal["geometry", "instance-number", "filename"]`; `sort_instances(rows: list[InstanceRow]) -> tuple[list[InstanceRow], SortMethod]`; `volume_info(rows: list[InstanceRow], method: SortMethod) -> VolumeInfo`.

- [ ] **Step 1: Write `models.py`** (no test of its own; exercised everywhere)

```python
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

SortMethod = Literal["geometry", "instance-number", "filename"]


@dataclass(frozen=True)
class InstanceRow:
    sop_uid: str
    series_uid: str
    instance_number: int | None
    rows: int
    cols: int
    bits_allocated: int
    pixel_representation: int
    samples_per_pixel: int
    num_frames: int
    ipp: tuple[float, float, float] | None
    iop: tuple[float, float, float, float, float, float] | None
    pixel_spacing: tuple[float, float] | None
    path: str
    transfer_syntax: str


@dataclass(frozen=True)
class VolumeInfo:
    is_volume: bool
    reason: str | None = None
    dims: tuple[int, int, int] | None = None
    spacing: tuple[float, float, float] | None = None
    origin: tuple[float, float, float] | None = None
    direction: tuple[float, ...] | None = None  # 9 floats: row, col, normal cosines


@dataclass(frozen=True)
class SeriesRow:
    series_uid: str
    study_uid: str
    modality: str | None
    series_desc: str | None
    series_number: int | None
    instance_count: int = 0
    thumb_sop_uid: str | None = None
    sort_method: SortMethod | None = None
    volume: VolumeInfo = field(default_factory=lambda: VolumeInfo(False, "not finalized"))


@dataclass(frozen=True)
class StudyRow:
    study_uid: str
    patient_name: str | None
    patient_id: str | None
    study_date: str | None
    study_time: str | None
    study_desc: str | None
    accession: str | None
    modalities: list[str]


@dataclass(frozen=True)
class SkippedFile:
    file: str
    reason: str


@dataclass
class IngestSummary:
    accepted: int = 0
    skipped: list[SkippedFile] = field(default_factory=list)
    study_uids: list[str] = field(default_factory=list)
```

- [ ] **Step 2: Write the failing geometry tests**

`backend/tests/test_geometry.py`:

```python
import random

import pytest

from app.geometry import sort_instances, volume_info
from app.models import InstanceRow


def row(i: int, *, ipp=None, iop=(1, 0, 0, 0, 1, 0), inst=None, rows=16, cols=16, ps=(0.5, 0.5),
        path=None, frames=1) -> InstanceRow:
    return InstanceRow(
        sop_uid=f"1.{i}", series_uid="S", instance_number=inst if inst is not None else i,
        rows=rows, cols=cols, bits_allocated=16, pixel_representation=1, samples_per_pixel=1,
        num_frames=frames, ipp=ipp, iop=iop, pixel_spacing=ps,
        path=path or f"img{i:04d}.dcm", transfer_syntax="1.2.840.10008.1.2.1",
    )


def axial(n: int, dz: float = 1.0) -> list[InstanceRow]:
    return [row(i, ipp=(0.0, 0.0, i * dz)) for i in range(n)]


def test_sorts_axial_by_position_not_instance_number() -> None:
    rows = [row(i, ipp=(0, 0, 10 - i), inst=i) for i in range(5)]
    out, method = sort_instances(rows)
    assert method == "geometry"
    assert [r.ipp[2] for r in out] == [6, 7, 8, 9, 10]


def test_sorts_shuffled_coronal() -> None:
    iop = (1, 0, 0, 0, 0, -1)  # normal = (0, 1, 0)
    rows = [row(i, ipp=(0, i * 2.0, 0), iop=iop) for i in range(10)]
    random.Random(1).shuffle(rows)
    out, method = sort_instances(rows)
    assert method == "geometry" and [r.ipp[1] for r in out] == [i * 2.0 for i in range(10)]


def test_sorts_oblique() -> None:
    iop = (0.7071, 0.7071, 0, -0.7071, 0.7071, 0)  # normal ~ (0,0,1)
    rows = [row(i, ipp=(i, i, i * 3.0), iop=iop) for i in reversed(range(4))]
    out, _ = sort_instances(rows)
    assert [r.ipp[2] for r in out] == [0.0, 3.0, 6.0, 9.0]


def test_missing_ipp_falls_back_to_instance_number() -> None:
    rows = [row(3, inst=3), row(1, inst=1), row(2, inst=2)]
    out, method = sort_instances(rows)
    assert method == "instance-number" and [r.instance_number for r in out] == [1, 2, 3]


def test_missing_everything_falls_back_to_filename() -> None:
    rows = [row(0, inst=None, path="b.dcm"), row(1, inst=None, path="a.dcm")]
    out, method = sort_instances(rows)
    assert method == "filename" and [r.path for r in out] == ["a.dcm", "b.dcm"]


def test_mixed_orientation_falls_back() -> None:
    rows = axial(4)
    rows[-1] = row(3, ipp=(0, 0, 3.0), iop=(1, 0, 0, 0, 0, -1))
    _, method = sort_instances(rows)
    assert method == "instance-number"


def test_regular_series_is_volume() -> None:
    out, m = sort_instances(axial(20, dz=2.5))
    v = volume_info(out, m)
    assert v.is_volume and v.reason is None
    assert v.dims == (16, 16, 20)
    assert v.spacing == pytest.approx((0.5, 0.5, 2.5))
    assert v.origin == (0.0, 0.0, 0.0)
    assert v.direction == pytest.approx((1, 0, 0, 0, 1, 0, 0, 0, 1))


def test_spacing_uses_median_gap_not_slice_thickness() -> None:
    rows = axial(11, dz=0.7)
    v = volume_info(*sort_instances(rows))
    assert v.spacing[2] == pytest.approx(0.7)


@pytest.mark.parametrize(
    "rows, reason",
    [
        ([row(0, inst=0), row(1, inst=1), row(2, inst=2)], "missing or inconsistent orientation"),
        (axial(2), "fewer than 3 slices"),
        (axial(3)[:2] + [row(2, ipp=(0, 0, 2.0), rows=32)], "inconsistent image dimensions"),
        (axial(3)[:2] + [row(2, ipp=(0, 0, 2.0), ps=(1.0, 1.0))], "inconsistent image dimensions"),
        (axial(4)[:3] + [row(3, ipp=(0, 0, 3.5))], "irregular slice spacing"),
        (axial(4)[:3] + [row(3, ipp=(0, 0, 2.0))], "irregular slice spacing"),  # duplicate position
    ],
)
def test_volume_failures(rows, reason) -> None:
    v = volume_info(*sort_instances(rows))
    assert not v.is_volume and v.reason == reason and v.dims is None


def test_multiframe_counts_frames() -> None:
    rows = [row(0, ipp=(0, 0, 0), frames=5)]
    v = volume_info(*sort_instances(rows))
    assert v.reason == "missing or inconsistent orientation" or v.dims is None
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python -m pytest tests/test_geometry.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.geometry'`.

- [ ] **Step 4: Implement `geometry.py`**

```python
from __future__ import annotations

import statistics

import numpy as np

from app.models import InstanceRow, SortMethod, VolumeInfo

_ORIENT_TOL = 1e-4
_GAP_TOL = 0.01  # 1 % of the median gap


def _normal(iop: tuple[float, ...]) -> np.ndarray:
    n = np.cross(np.array(iop[:3], dtype=float), np.array(iop[3:6], dtype=float))
    return n / np.linalg.norm(n)


def _same_orientation(rows: list[InstanceRow]) -> bool:
    ref = np.array(rows[0].iop, dtype=float)
    return all(np.allclose(np.array(r.iop, dtype=float), ref, atol=_ORIENT_TOL) for r in rows)


def sort_instances(rows: list[InstanceRow]) -> tuple[list[InstanceRow], SortMethod]:
    if rows and all(r.ipp is not None and r.iop is not None for r in rows) and _same_orientation(rows):
        normal = _normal(rows[0].iop)  # type: ignore[arg-type]
        keyed = sorted(rows, key=lambda r: float(np.dot(np.array(r.ipp, dtype=float), normal)))
        return keyed, "geometry"
    if rows and all(r.instance_number is not None for r in rows):
        return sorted(rows, key=lambda r: (r.instance_number, r.path)), "instance-number"
    return sorted(rows, key=lambda r: r.path), "filename"


def _positions(rows: list[InstanceRow]) -> list[float]:
    normal = _normal(rows[0].iop)  # type: ignore[arg-type]
    return [float(np.dot(np.array(r.ipp, dtype=float), normal)) for r in rows]


def volume_info(rows: list[InstanceRow], method: SortMethod) -> VolumeInfo:
    if method != "geometry":
        return VolumeInfo(False, "missing or inconsistent orientation")
    n_slices = sum(r.num_frames for r in rows)
    if n_slices < 3:
        return VolumeInfo(False, "fewer than 3 slices")
    first = rows[0]
    sig = (first.rows, first.cols, first.bits_allocated, first.pixel_representation, first.pixel_spacing)
    if any(
        (r.rows, r.cols, r.bits_allocated, r.pixel_representation, r.pixel_spacing) != sig for r in rows
    ):
        return VolumeInfo(False, "inconsistent image dimensions")
    if not _same_orientation(rows):
        return VolumeInfo(False, "mixed orientations")
    if any(r.num_frames != 1 for r in rows):
        return VolumeInfo(False, "irregular slice spacing")  # multi-frame spacing not derivable here
    pos = _positions(rows)
    gaps = [b - a for a, b in zip(pos, pos[1:], strict=True)]
    median = statistics.median(gaps)
    if median <= 0 or any(abs(g - median) > _GAP_TOL * median for g in gaps):
        return VolumeInfo(False, "irregular slice spacing")
    if first.pixel_spacing is None:
        return VolumeInfo(False, "inconsistent image dimensions")
    normal = _normal(first.iop)  # type: ignore[arg-type]
    iop = first.iop
    assert iop is not None and first.ipp is not None
    return VolumeInfo(
        True,
        None,
        dims=(first.cols, first.rows, n_slices),
        spacing=(first.pixel_spacing[1], first.pixel_spacing[0], median),
        origin=first.ipp,
        direction=tuple(float(v) for v in (*iop[:3], *iop[3:6], *normal)),
    )
```

Note on conventions: `dims` and `spacing` are **(x, y, z)** = (columns, rows, slices) and (column spacing = `PixelSpacing[1]`, row spacing = `PixelSpacing[0]`, slice gap). This is what the frontend and the `volume-info` endpoint expose.

- [ ] **Step 5: Run tests and linters**

Run: `python -m pytest tests/test_geometry.py -v; ruff check .; mypy app/`
Expected: all passed; clean. If mypy complains about the `# type: ignore` comments being unused, remove them.

---

### Task 6: `repo.py` — SQLite access layer

**Files:**
- Create: `backend/app/repo.py`, `backend/tests/test_repo.py`

**Interfaces:**
- Produces: `upsert_study(conn, StudyRow)`, `upsert_series(conn, SeriesRow)` (basic columns only), `upsert_instance(conn, InstanceRow)`, `update_series_finalized(conn, series_uid, *, instance_count, thumb_sop_uid, sort_method, volume: VolumeInfo)`, `list_studies(conn, *, patient_name=None, patient_id=None, study_date=None, limit=100, offset=0) -> list[StudyRow]`, `get_study(conn, uid) -> StudyRow | None`, `list_series(conn, study_uid) -> list[SeriesRow]`, `get_series(conn, series_uid) -> SeriesRow | None`, `list_instances(conn, series_uid) -> list[InstanceRow]`, `get_instance(conn, sop_uid) -> InstanceRow | None`, `count_series_and_instances(conn, study_uid) -> tuple[int, int]`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_repo.py`:

```python
from pathlib import Path

from app import repo
from app.db import connect, init_schema
from app.models import InstanceRow, SeriesRow, StudyRow, VolumeInfo


def _conn(tmp_path: Path):
    c = connect(tmp_path / "x.sqlite")
    init_schema(c)
    return c


def _study(uid="S1") -> StudyRow:
    return StudyRow(uid, "Doe^J", "P1", "20240101", "1200", "desc", "ACC", ["CT"])


def _series(uid="SE1", study="S1") -> SeriesRow:
    return SeriesRow(uid, study, "CT", "sdesc", 3)


def _inst(uid="I1", series="SE1", inst=1) -> InstanceRow:
    return InstanceRow(uid, series, inst, 16, 16, 16, 1, 1, 1, (0.0, 0.0, float(inst)),
                       (1, 0, 0, 0, 1, 0), (0.5, 0.5), f"/tmp/{uid}.dcm", "1.2.840.10008.1.2.1")


def test_roundtrip_and_upsert(tmp_path: Path) -> None:
    c = _conn(tmp_path)
    repo.upsert_study(c, _study())
    repo.upsert_series(c, _series())
    repo.upsert_instance(c, _inst())
    repo.upsert_instance(c, _inst())  # idempotent
    assert repo.get_study(c, "S1") == _study()
    assert repo.get_series(c, "SE1").series_desc == "sdesc"
    assert repo.list_instances(c, "SE1") == [_inst()]
    assert repo.get_instance(c, "I1") == _inst()
    assert repo.count_series_and_instances(c, "S1") == (1, 1)


def test_finalize_writes_volume_columns(tmp_path: Path) -> None:
    c = _conn(tmp_path)
    repo.upsert_study(c, _study()); repo.upsert_series(c, _series()); repo.upsert_instance(c, _inst())
    v = VolumeInfo(True, None, (16, 16, 3), (0.5, 0.5, 1.0), (0.0, 0.0, 0.0), (1, 0, 0, 0, 1, 0, 0, 0, 1))
    repo.update_series_finalized(c, "SE1", instance_count=3, thumb_sop_uid="I1", sort_method="geometry", volume=v)
    s = repo.get_series(c, "SE1")
    assert s.instance_count == 3 and s.thumb_sop_uid == "I1" and s.sort_method == "geometry"
    assert s.volume == v


def test_list_studies_filters(tmp_path: Path) -> None:
    c = _conn(tmp_path)
    repo.upsert_study(c, _study("A")); repo.upsert_study(c, StudyRow("B", "Roe^R", "P2", "20230505", None, None, None, ["MR"]))
    assert [s.study_uid for s in repo.list_studies(c, patient_name="doe")] == ["A"]
    assert [s.study_uid for s in repo.list_studies(c, patient_id="P2")] == ["B"]
    assert [s.study_uid for s in repo.list_studies(c, study_date="20230505")] == ["B"]
    assert len(repo.list_studies(c, limit=1)) == 1 and len(repo.list_studies(c, limit=1, offset=1)) == 1
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_repo.py -v`
Expected: FAIL with `ImportError: cannot import name 'repo'`.

- [ ] **Step 3: Implement `repo.py`**

```python
from __future__ import annotations

import sqlite3
from typing import Any

from app.models import InstanceRow, SeriesRow, SortMethod, StudyRow, VolumeInfo


def _f(v: Any) -> float | None:
    return None if v is None else float(v)


def upsert_study(conn: sqlite3.Connection, s: StudyRow) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO study VALUES (?,?,?,?,?,?,?,?)",
        (s.study_uid, s.patient_name, s.patient_id, s.study_date, s.study_time, s.study_desc,
         s.accession, ",".join(sorted(set(s.modalities)))),
    )
    conn.commit()


def upsert_series(conn: sqlite3.Connection, s: SeriesRow) -> None:
    conn.execute(
        """INSERT INTO series (series_uid, study_uid, modality, series_desc, series_number)
           VALUES (?,?,?,?,?)
           ON CONFLICT(series_uid) DO UPDATE SET modality=excluded.modality,
             series_desc=excluded.series_desc, series_number=excluded.series_number""",
        (s.series_uid, s.study_uid, s.modality, s.series_desc, s.series_number),
    )
    conn.commit()


def upsert_instance(conn: sqlite3.Connection, i: InstanceRow) -> None:
    ipp = i.ipp or (None, None, None)
    conn.execute(
        "INSERT OR REPLACE INTO instance VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (i.sop_uid, i.series_uid, i.instance_number, i.rows, i.cols, i.bits_allocated,
         i.pixel_representation, i.samples_per_pixel, i.num_frames, ipp[0], ipp[1], ipp[2],
         "\\".join(map(str, i.iop)) if i.iop else None,
         "\\".join(map(str, i.pixel_spacing)) if i.pixel_spacing else None,
         i.path, i.transfer_syntax),
    )
    conn.commit()


def update_series_finalized(
    conn: sqlite3.Connection, series_uid: str, *, instance_count: int, thumb_sop_uid: str | None,
    sort_method: SortMethod, volume: VolumeInfo,
) -> None:
    d, sp, o = volume.dims or (None,) * 3, volume.spacing or (None,) * 3, volume.origin or (None,) * 3
    conn.execute(
        """UPDATE series SET instance_count=?, thumb_sop_uid=?, sort_method=?, is_volume=?, volume_reason=?,
           dim_x=?, dim_y=?, dim_z=?, spacing_x=?, spacing_y=?, spacing_z=?,
           origin_x=?, origin_y=?, origin_z=?, direction=? WHERE series_uid=?""",
        (instance_count, thumb_sop_uid, sort_method, int(volume.is_volume), volume.reason,
         d[0], d[1], d[2], sp[0], sp[1], sp[2], o[0], o[1], o[2],
         "\\".join(map(str, volume.direction)) if volume.direction else None, series_uid),
    )
    conn.commit()


def _study_from_row(r: sqlite3.Row) -> StudyRow:
    return StudyRow(r["study_uid"], r["patient_name"], r["patient_id"], r["study_date"], r["study_time"],
                    r["study_desc"], r["accession"], [m for m in (r["modalities"] or "").split(",") if m])


def _series_from_row(r: sqlite3.Row) -> SeriesRow:
    vol = VolumeInfo(
        bool(r["is_volume"]), r["volume_reason"],
        dims=(r["dim_x"], r["dim_y"], r["dim_z"]) if r["dim_x"] is not None else None,
        spacing=(r["spacing_x"], r["spacing_y"], r["spacing_z"]) if r["spacing_x"] is not None else None,
        origin=(r["origin_x"], r["origin_y"], r["origin_z"]) if r["origin_x"] is not None else None,
        direction=tuple(float(v) for v in r["direction"].split("\\")) if r["direction"] else None,
    ) if r["sort_method"] is not None else VolumeInfo(False, "not finalized")
    return SeriesRow(r["series_uid"], r["study_uid"], r["modality"], r["series_desc"], r["series_number"],
                     r["instance_count"] or 0, r["thumb_sop_uid"], r["sort_method"], vol)


def _instance_from_row(r: sqlite3.Row) -> InstanceRow:
    ipp = (r["ipp_x"], r["ipp_y"], r["ipp_z"]) if r["ipp_x"] is not None else None
    iop = tuple(float(v) for v in r["iop"].split("\\")) if r["iop"] else None
    ps = tuple(float(v) for v in r["pixel_spacing"].split("\\")) if r["pixel_spacing"] else None
    return InstanceRow(r["sop_uid"], r["series_uid"], r["instance_number"], r["rows"], r["cols"],
                       r["bits_allocated"], r["pixel_representation"], r["samples_per_pixel"],
                       r["num_frames"], ipp, iop, ps, r["path"], r["transfer_syntax"])  # type: ignore[arg-type]


def list_studies(conn: sqlite3.Connection, *, patient_name: str | None = None, patient_id: str | None = None,
                 study_date: str | None = None, limit: int = 100, offset: int = 0) -> list[StudyRow]:
    where, args: list[Any] = [], []
    if patient_name:
        where.append("LOWER(patient_name) LIKE ?"); args.append(f"%{patient_name.lower().strip('*')}%")
    if patient_id:
        where.append("patient_id = ?"); args.append(patient_id)
    if study_date:
        where.append("study_date = ?"); args.append(study_date)
    sql = "SELECT * FROM study" + (" WHERE " + " AND ".join(where) if where else "")
    sql += " ORDER BY study_date DESC, study_uid LIMIT ? OFFSET ?"
    return [_study_from_row(r) for r in conn.execute(sql, (*args, limit, offset))]


def get_study(conn: sqlite3.Connection, uid: str) -> StudyRow | None:
    r = conn.execute("SELECT * FROM study WHERE study_uid=?", (uid,)).fetchone()
    return _study_from_row(r) if r else None


def list_series(conn: sqlite3.Connection, study_uid: str) -> list[SeriesRow]:
    rows = conn.execute("SELECT * FROM series WHERE study_uid=? ORDER BY series_number, series_uid", (study_uid,))
    return [_series_from_row(r) for r in rows]


def get_series(conn: sqlite3.Connection, series_uid: str) -> SeriesRow | None:
    r = conn.execute("SELECT * FROM series WHERE series_uid=?", (series_uid,)).fetchone()
    return _series_from_row(r) if r else None


def list_instances(conn: sqlite3.Connection, series_uid: str) -> list[InstanceRow]:
    rows = conn.execute("SELECT * FROM instance WHERE series_uid=?", (series_uid,))
    return [_instance_from_row(r) for r in rows]


def get_instance(conn: sqlite3.Connection, sop_uid: str) -> InstanceRow | None:
    r = conn.execute("SELECT * FROM instance WHERE sop_uid=?", (sop_uid,)).fetchone()
    return _instance_from_row(r) if r else None


def count_series_and_instances(conn: sqlite3.Connection, study_uid: str) -> tuple[int, int]:
    r = conn.execute(
        """SELECT COUNT(DISTINCT s.series_uid), COUNT(i.sop_uid) FROM series s
           LEFT JOIN instance i ON i.series_uid = s.series_uid WHERE s.study_uid=?""",
        (study_uid,),
    ).fetchone()
    return int(r[0]), int(r[1])
```

- [ ] **Step 4: Run tests and linters**

Run: `python -m pytest tests/test_repo.py -v; ruff check .; mypy app/`
Expected: 3 passed; clean.

---

### Task 7: `indexer.py` — index, finalize, ingest directory

**Files:**
- Create: `backend/app/ingest/indexer.py`, `backend/tests/test_indexer.py`

**Interfaces:**
- Produces: `instance_row_from_dataset(ds: Dataset, path: Path) -> InstanceRow`; `index_instance(conn, ds, path) -> None` (upserts study, series, instance); `finalize_series(conn, series_uid) -> SeriesRow`; `ingest_directory(conn, directory: Path, store_dir: Path) -> IngestSummary`; `ingest_files(conn, paths: list[Path], store_dir: Path) -> IngestSummary` (shared by directory ingest and upload).

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_indexer.py`:

```python
from pathlib import Path

import pydicom
from pydicom.uid import JPEG2000Lossless

from app import repo
from app.db import connect, init_schema
from app.ingest.indexer import finalize_series, ingest_directory
from tests.conftest import make_ct_series, write_series


def _conn(tmp_path: Path):
    c = connect(tmp_path / "idx.sqlite"); init_schema(c); return c


def test_ingest_directory_indexes_and_finalizes(tmp_path: Path) -> None:
    c = _conn(tmp_path)
    dsets = make_ct_series(5)
    write_series(dsets, tmp_path / "in")
    summary = ingest_directory(c, tmp_path / "in", tmp_path / "store")
    assert summary.accepted == 5 and summary.skipped == [] and summary.study_uids == [dsets[0].StudyInstanceUID]
    s = repo.get_series(c, dsets[0].SeriesInstanceUID)
    assert s.instance_count == 5 and s.sort_method == "geometry" and s.volume.is_volume
    assert s.volume.dims == (16, 16, 5) and s.thumb_sop_uid == dsets[2].SOPInstanceUID
    st = repo.get_study(c, dsets[0].StudyInstanceUID)
    assert st.patient_name == "Test^Patient" and st.modalities == ["CT"]
    stored = tmp_path / "store" / dsets[0].StudyInstanceUID / dsets[0].SeriesInstanceUID
    assert len(list(stored.glob("*.dcm"))) == 5


def test_reingest_is_idempotent(tmp_path: Path) -> None:
    c = _conn(tmp_path)
    write_series(make_ct_series(3), tmp_path / "in")
    ingest_directory(c, tmp_path / "in", tmp_path / "store")
    ingest_directory(c, tmp_path / "in", tmp_path / "store")
    (sid,) = [r[0] for r in c.execute("SELECT series_uid FROM series")]
    assert repo.get_series(c, sid).instance_count == 3


def test_non_dicom_and_sr_are_skipped_with_reason(tmp_path: Path) -> None:
    c = _conn(tmp_path)
    write_series(make_ct_series(3), tmp_path / "in")
    (tmp_path / "in" / "notes.txt").write_text("hi")
    (sr,) = make_ct_series(1)
    del sr.PixelData
    pydicom.dcmwrite(tmp_path / "in" / "sr.dcm", sr, enforce_file_format=True)
    summary = ingest_directory(c, tmp_path / "in", tmp_path / "store")
    assert summary.accepted == 3
    assert sorted(s.file for s in summary.skipped) == ["notes.txt", "sr.dcm"]
    assert all(s.reason for s in summary.skipped)


def test_compressed_input_is_stored_uncompressed(tmp_path: Path) -> None:
    c = _conn(tmp_path)
    write_series(make_ct_series(3, transfer_syntax=JPEG2000Lossless), tmp_path / "in")
    summary = ingest_directory(c, tmp_path / "in", tmp_path / "store")
    assert summary.accepted == 3
    for p in (tmp_path / "store").rglob("*.dcm"):
        assert pydicom.dcmread(p).file_meta.TransferSyntaxUID == "1.2.840.10008.1.2.1"


def test_non_volume_series_is_indexed_with_reason(tmp_path: Path) -> None:
    c = _conn(tmp_path)
    write_series(make_ct_series(4, irregular=True), tmp_path / "in")
    ingest_directory(c, tmp_path / "in", tmp_path / "store")
    (sid,) = [r[0] for r in c.execute("SELECT series_uid FROM series")]
    s = finalize_series(c, sid)
    assert not s.volume.is_volume and s.volume.reason == "irregular slice spacing"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_indexer.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.ingest.indexer'`.

- [ ] **Step 3: Implement `indexer.py`**

```python
from __future__ import annotations

import sqlite3
from pathlib import Path

from pydicom.dataset import Dataset

from app import repo
from app.geometry import sort_instances, volume_info
from app.ingest.decode import DecodeError, to_uncompressed
from app.ingest.reader import NotDicomError, read_dicom
from app.ingest.store import file_instance
from app.models import IngestSummary, InstanceRow, SeriesRow, SkippedFile, StudyRow


def _floats(ds: Dataset, tag: str, n: int) -> tuple[float, ...] | None:
    v = ds.get(tag)
    if v is None:
        return None
    try:
        vals = tuple(float(x) for x in v)
    except (TypeError, ValueError):
        return None
    return vals if len(vals) == n else None


def instance_row_from_dataset(ds: Dataset, path: Path) -> InstanceRow:
    return InstanceRow(
        sop_uid=str(ds.SOPInstanceUID), series_uid=str(ds.SeriesInstanceUID),
        instance_number=int(ds.InstanceNumber) if ds.get("InstanceNumber") not in (None, "") else None,
        rows=int(ds.Rows), cols=int(ds.Columns), bits_allocated=int(ds.BitsAllocated),
        pixel_representation=int(ds.get("PixelRepresentation", 0)),
        samples_per_pixel=int(ds.get("SamplesPerPixel", 1)),
        num_frames=int(ds.get("NumberOfFrames", 1) or 1),
        ipp=_floats(ds, "ImagePositionPatient", 3),  # type: ignore[arg-type]
        iop=_floats(ds, "ImageOrientationPatient", 6),  # type: ignore[arg-type]
        pixel_spacing=_floats(ds, "PixelSpacing", 2),  # type: ignore[arg-type]
        path=str(path), transfer_syntax=str(ds.file_meta.TransferSyntaxUID),
    )


def index_instance(conn: sqlite3.Connection, ds: Dataset, path: Path) -> None:
    study_uid = str(ds.StudyInstanceUID)
    existing = repo.get_study(conn, study_uid)
    mods = set(existing.modalities) if existing else set()
    if ds.get("Modality"):
        mods.add(str(ds.Modality))
    repo.upsert_study(conn, StudyRow(
        study_uid, str(ds.get("PatientName", "")) or None, str(ds.get("PatientID", "")) or None,
        str(ds.get("StudyDate", "")) or None, str(ds.get("StudyTime", "")) or None,
        str(ds.get("StudyDescription", "")) or None, str(ds.get("AccessionNumber", "")) or None,
        sorted(mods),
    ))
    repo.upsert_series(conn, SeriesRow(
        str(ds.SeriesInstanceUID), study_uid, str(ds.get("Modality", "")) or None,
        str(ds.get("SeriesDescription", "")) or None,
        int(ds.SeriesNumber) if ds.get("SeriesNumber") not in (None, "") else None,
    ))
    repo.upsert_instance(conn, instance_row_from_dataset(ds, path))


def finalize_series(conn: sqlite3.Connection, series_uid: str) -> SeriesRow:
    rows = repo.list_instances(conn, series_uid)
    ordered, method = sort_instances(rows)
    vol = volume_info(ordered, method)
    thumb = ordered[len(ordered) // 2].sop_uid if ordered else None
    repo.update_series_finalized(
        conn, series_uid, instance_count=sum(r.num_frames for r in ordered),
        thumb_sop_uid=thumb, sort_method=method, volume=vol,
    )
    series = repo.get_series(conn, series_uid)
    assert series is not None
    return series


def ingest_files(conn: sqlite3.Connection, paths: list[Path], store_dir: Path) -> IngestSummary:
    summary = IngestSummary()
    touched: dict[str, str] = {}  # series_uid -> study_uid
    for p in paths:
        try:
            ds = read_dicom(p)
            to_uncompressed(ds)
        except (NotDicomError, DecodeError) as e:
            summary.skipped.append(SkippedFile(p.name, str(e)))
            continue
        dest = file_instance(ds, store_dir)
        index_instance(conn, ds, dest)
        touched[str(ds.SeriesInstanceUID)] = str(ds.StudyInstanceUID)
        summary.accepted += 1
    for series_uid in touched:
        finalize_series(conn, series_uid)
    summary.study_uids = sorted(set(touched.values()))
    return summary


def ingest_directory(conn: sqlite3.Connection, directory: Path, store_dir: Path) -> IngestSummary:
    paths = sorted(p for p in directory.rglob("*") if p.is_file())
    return ingest_files(conn, paths, store_dir)
```

- [ ] **Step 4: Run tests and linters**

Run: `python -m pytest tests/test_indexer.py -v; ruff check .; mypy app/`
Expected: 5 passed; clean.

---

### Task 8: `json_model.py` — DICOM JSON model

**Files:**
- Create: `backend/app/dicomweb/__init__.py`, `backend/app/dicomweb/json_model.py`, `backend/tests/test_json_model.py`

**Interfaces:**
- Produces: `dataset_to_dicom_json(ds: Dataset, *, include_bulk: bool = False) -> dict[str, Any]`; `BULK_VRS = {"OB", "OW", "OF", "OD", "OL", "OV", "UN"}`.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_json_model.py`:

```python
from pydicom.dataset import Dataset
from pydicom.sequence import Sequence

from app.dicomweb.json_model import dataset_to_dicom_json
from tests.conftest import make_ct_series


def test_pn_and_numeric_typing() -> None:
    (ds,) = make_ct_series(1)
    j = dataset_to_dicom_json(ds)
    assert j["00100010"] == {"vr": "PN", "Value": [{"Alphabetic": "Test^Patient"}]}
    assert j["00280010"] == {"vr": "US", "Value": [16]}
    assert j["00281052"] == {"vr": "DS", "Value": [-1024.0]}
    assert j["00200032"]["Value"] == [0.0, 0.0, 0.0] and j["00200032"]["vr"] == "DS"
    assert j["00200013"] == {"vr": "IS", "Value": [1]}


def test_empty_element_has_no_value_key() -> None:
    ds = Dataset(); ds.PatientName = ""; ds.StudyDescription = None
    j = dataset_to_dicom_json(ds)
    assert j["00100010"] == {"vr": "PN"} and j["00081030"] == {"vr": "LO"}


def test_bulk_data_omitted_by_default_and_included_on_request() -> None:
    (ds,) = make_ct_series(1)
    assert "7FE00010" not in dataset_to_dicom_json(ds)
    assert dataset_to_dicom_json(ds, include_bulk=True)["7FE00010"]["vr"] == "OW"


def test_sequences_recurse() -> None:
    ds = Dataset(); item = Dataset(); item.CodeValue = "X"; ds.ProcedureCodeSequence = Sequence([item])
    j = dataset_to_dicom_json(ds)
    assert j["00081032"] == {"vr": "SQ", "Value": [{"00080100": {"vr": "SH", "Value": ["X"]}}]}


def test_matches_pydicom_reference_for_non_bulk() -> None:
    (ds,) = make_ct_series(1)
    ref = ds.to_json_dict(bulk_data_threshold=0, bulk_data_element_handler=lambda e: "x")
    ours = dataset_to_dicom_json(ds)
    for tag, v in ours.items():
        assert ref[tag]["vr"] == v["vr"]
        if v["vr"] not in ("DS", "IS") and "Value" in v:
            assert ref[tag]["Value"] == v["Value"], tag
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_json_model.py -v`
Expected: FAIL with `ModuleNotFoundError`.

- [ ] **Step 3: Implement `json_model.py`**

`backend/app/dicomweb/__init__.py`: empty.

```python
from __future__ import annotations

from typing import Any

from pydicom.dataelem import DataElement
from pydicom.dataset import Dataset
from pydicom.multival import MultiValue
from pydicom.valuerep import PersonName

BULK_VRS = {"OB", "OW", "OF", "OD", "OL", "OV", "UN"}
FLOAT_VRS = {"FL", "FD", "DS"}
INT_VRS = {"IS", "SL", "SS", "UL", "US", "SV", "UV"}


def _values(el: DataElement) -> list[Any]:
    raw = el.value
    items = list(raw) if isinstance(raw, MultiValue | list | tuple) else [raw]
    out: list[Any] = []
    for v in items:
        if v is None or v == "":
            continue
        if el.VR == "PN":
            out.append({"Alphabetic": str(PersonName(v))})
        elif el.VR in FLOAT_VRS:
            out.append(float(v))
        elif el.VR in INT_VRS:
            out.append(int(v))
        elif el.VR == "AT":
            out.append(f"{int(v):08X}")
        else:
            out.append(str(v))
    return out


def dataset_to_dicom_json(ds: Dataset, *, include_bulk: bool = False) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for el in ds:
        if el.tag.is_private and not include_bulk:
            continue
        tag = f"{el.tag.group:04X}{el.tag.element:04X}"
        vr = str(el.VR)
        if vr in BULK_VRS:
            if not include_bulk:
                continue
            out[tag] = {"vr": vr, "InlineBinary": __import__("base64").b64encode(bytes(el.value)).decode()}
            continue
        if vr == "SQ":
            out[tag] = {"vr": vr, "Value": [dataset_to_dicom_json(item, include_bulk=include_bulk) for item in el.value]}
            continue
        if el.is_empty:
            out[tag] = {"vr": vr}
            continue
        vals = _values(el)
        out[tag] = {"vr": vr, "Value": vals} if vals else {"vr": vr}
    return out
```

Replace the `__import__("base64")` shortcut with a top-level `import base64` when you write the file — it is shown inline only to keep the snippet self-contained.

- [ ] **Step 4: Run tests and linters**

Run: `python -m pytest tests/test_json_model.py -v; ruff check .; mypy app/`
Expected: 5 passed; clean.

---

### Task 9: QIDO-RS router

**Files:**
- Create: `backend/app/dicomweb/qido.py`, `backend/tests/test_qido.py`
- Modify: `backend/app/main.py` (include router)

**Interfaces:**
- Produces: `GET /dicomweb/studies`, `GET /dicomweb/studies/{study}/series`, `GET /dicomweb/studies/{study}/series/{series}/instances` → `application/dicom+json` arrays; helper `get_db(request) -> sqlite3.Connection` in `app/dicomweb/deps.py` reused by later routers.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_qido.py`:

```python
from pathlib import Path

from app.ingest.indexer import ingest_directory
from tests.conftest import make_ct_series, write_series

DJ = "application/dicom+json"


def _seed(client, tmp_path: Path, n=4, **kw):
    dsets = make_ct_series(n, **kw)
    write_series(dsets, tmp_path / "in")
    ingest_directory(client.app.state.db, tmp_path / "in", client.app.state.settings.store_dir)
    return dsets


def test_studies_list(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path)
    r = client.get("/dicomweb/studies")
    assert r.status_code == 200 and r.headers["content-type"].startswith(DJ)
    (s,) = r.json()
    assert s["0020000D"]["Value"] == [d[0].StudyInstanceUID]
    assert s["00100010"]["Value"] == [{"Alphabetic": "Test^Patient"}]
    assert s["00080061"]["Value"] == ["CT"]
    assert s["00201206"]["Value"] == [1] and s["00201208"]["Value"] == [4]


def test_studies_filters_and_paging(client, tmp_path: Path) -> None:
    _seed(client, tmp_path)
    assert client.get("/dicomweb/studies", params={"PatientName": "nobody"}).json() == []
    assert len(client.get("/dicomweb/studies", params={"PatientID": "P001"}).json()) == 1
    assert client.get("/dicomweb/studies", params={"limit": 1, "offset": 5}).json() == []


def test_series_and_instances(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path)
    su, se = d[0].StudyInstanceUID, d[0].SeriesInstanceUID
    (s,) = client.get(f"/dicomweb/studies/{su}/series").json()
    assert s["0020000E"]["Value"] == [se] and s["00080060"]["Value"] == ["CT"] and s["00201209"]["Value"] == [4]
    inst = client.get(f"/dicomweb/studies/{su}/series/{se}/instances").json()
    assert len(inst) == 4 and {i["00080018"]["Value"][0] for i in inst} == {x.SOPInstanceUID for x in d}
    assert inst[0]["00280010"]["Value"] == [16]


def test_unknown_uids_404(client) -> None:
    assert client.get("/dicomweb/studies/9.9/series").status_code == 404
    assert client.get("/dicomweb/studies/9.9/series/8.8/instances").status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_qido.py -v`
Expected: FAIL — 404s where 200 expected (routes do not exist yet).

- [ ] **Step 3: Implement `deps.py` and `qido.py`, include router**

`backend/app/dicomweb/deps.py`:

```python
from __future__ import annotations

import sqlite3

from fastapi import Request

from app.config import Settings

DICOM_JSON = "application/dicom+json"


def get_db(request: Request) -> sqlite3.Connection:
    return request.app.state.db  # type: ignore[no-any-return]


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings  # type: ignore[no-any-return]
```

`backend/app/dicomweb/qido.py`:

```python
from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from app import repo
from app.dicomweb.deps import DICOM_JSON, get_db
from app.models import InstanceRow, SeriesRow, StudyRow

router = APIRouter(prefix="/dicomweb", tags=["qido"])


def _el(vr: str, *values: Any) -> dict[str, Any]:
    vals = [v for v in values if v not in (None, "")]
    return {"vr": vr, "Value": vals} if vals else {"vr": vr}


def study_json(conn: sqlite3.Connection, s: StudyRow) -> dict[str, Any]:
    n_series, n_inst = repo.count_series_and_instances(conn, s.study_uid)
    return {
        "00080020": _el("DA", s.study_date), "00080030": _el("TM", s.study_time),
        "00080050": _el("SH", s.accession), "00080061": _el("CS", *s.modalities),
        "00081030": _el("LO", s.study_desc),
        "00100010": {"vr": "PN", "Value": [{"Alphabetic": s.patient_name}]} if s.patient_name else {"vr": "PN"},
        "00100020": _el("LO", s.patient_id), "0020000D": _el("UI", s.study_uid),
        "00201206": _el("IS", n_series), "00201208": _el("IS", n_inst),
    }


def series_json(s: SeriesRow) -> dict[str, Any]:
    return {
        "00080060": _el("CS", s.modality), "0008103E": _el("LO", s.series_desc),
        "0020000D": _el("UI", s.study_uid), "0020000E": _el("UI", s.series_uid),
        "00200011": _el("IS", s.series_number), "00201209": _el("IS", s.instance_count),
    }


def instance_json(i: InstanceRow) -> dict[str, Any]:
    return {
        "00080018": _el("UI", i.sop_uid), "0020000E": _el("UI", i.series_uid),
        "00200013": _el("IS", i.instance_number), "00280008": _el("IS", i.num_frames),
        "00280010": _el("US", i.rows), "00280011": _el("US", i.cols),
    }


def _dj(payload: Any) -> JSONResponse:
    return JSONResponse(payload, media_type=DICOM_JSON)


@router.get("/studies")
def search_studies(
    conn: sqlite3.Connection = Depends(get_db),
    PatientName: str | None = None, PatientID: str | None = None, StudyDate: str | None = None,
    limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0),
) -> JSONResponse:
    studies = repo.list_studies(conn, patient_name=PatientName, patient_id=PatientID,
                                study_date=StudyDate, limit=limit, offset=offset)
    return _dj([study_json(conn, s) for s in studies])


@router.get("/studies/{study_uid}/series")
def search_series(study_uid: str, conn: sqlite3.Connection = Depends(get_db)) -> JSONResponse:
    if repo.get_study(conn, study_uid) is None:
        raise HTTPException(404, f"study {study_uid} not found")
    return _dj([series_json(s) for s in repo.list_series(conn, study_uid)])


@router.get("/studies/{study_uid}/series/{series_uid}/instances")
def search_instances(study_uid: str, series_uid: str, conn: sqlite3.Connection = Depends(get_db)) -> JSONResponse:
    s = repo.get_series(conn, series_uid)
    if s is None or s.study_uid != study_uid:
        raise HTTPException(404, f"series {series_uid} not found in study {study_uid}")
    return _dj([instance_json(i) for i in repo.list_instances(conn, series_uid)])
```

In `backend/app/main.py`, add `from app.dicomweb import qido` and `app.include_router(qido.router)` after the health router.

- [ ] **Step 4: Run tests and linters**

Run: `python -m pytest tests/test_qido.py -v; ruff check .; mypy app/`
Expected: 4 passed; clean. (ruff may flag capitalised parameter names `PatientName` with N-rules; they are not in the selected rule set, so this is fine.)

---

### Task 10: WADO-RS router — metadata, frames, instance, rendered

**Files:**
- Create: `backend/app/dicomweb/multipart.py`, `backend/app/dicomweb/wado.py`, `backend/tests/test_wado.py`
- Modify: `backend/app/main.py` (include router)

**Interfaces:**
- Produces: `multipart_related(parts: list[tuple[str, bytes]]) -> tuple[bytes, str]` → (body, content-type header value); routes `…/metadata`, `…/instances/{sop}/frames/{n}`, `…/instances/{sop}`, `…/instances/{sop}/rendered`; helper `load_sorted_series(conn, study_uid, series_uid) -> tuple[SeriesRow, list[InstanceRow], SortMethod]` (raises 404) reused by the volume API.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_wado.py`:

```python
import io
from pathlib import Path

import numpy as np
import pydicom
from PIL import Image

from app.ingest.indexer import ingest_directory
from tests.conftest import make_ct_series, write_series


def _seed(client, tmp_path: Path, n=4, **kw):
    dsets = make_ct_series(n, **kw)
    write_series(dsets, tmp_path / "in")
    ingest_directory(client.app.state.db, tmp_path / "in", client.app.state.settings.store_dir)
    return dsets


def _url(d, sop=None):
    base = f"/dicomweb/studies/{d[0].StudyInstanceUID}/series/{d[0].SeriesInstanceUID}"
    return base if sop is None else f"{base}/instances/{sop}"


def test_metadata_is_sorted_full_headers_without_pixels(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path, 5)
    d_reversed = list(reversed(d))  # write order != anatomical order
    write_series(d_reversed, tmp_path / "in2")
    r = client.get(_url(d) + "/metadata")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/dicom+json")
    assert r.headers["x-sort-method"] == "geometry"
    md = r.json()
    assert [m["00200032"]["Value"][2] for m in md] == [0.0, 1.0, 2.0, 3.0, 4.0]
    assert all("7FE00010" not in m for m in md)
    assert md[0]["00020010"]["Value"] == ["1.2.840.10008.1.2.1"]
    assert md[0]["00281053"]["Value"] == [1.0] and md[0]["00281050"]["Value"] == [40.0]


def test_frame_bytes_and_multipart_framing(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path, 2)
    r = client.get(_url(d, d[0].SOPInstanceUID) + "/frames/1", headers={"Accept": "application/octet-stream"})
    assert r.status_code == 200
    ct = r.headers["content-type"]
    assert ct.startswith('multipart/related; type="application/octet-stream"; boundary=')
    boundary = ct.split("boundary=")[1].strip('"')
    body = r.content
    assert body.startswith(f"--{boundary}\r\n".encode()) and body.rstrip().endswith(f"--{boundary}--".encode())
    head, _, rest = body.partition(b"\r\n\r\n")
    assert b"Content-Type: application/octet-stream" in head
    payload = rest[: 16 * 16 * 2]
    assert np.array_equal(np.frombuffer(payload, dtype="<i2").reshape(16, 16), d[0].pixel_array)
    assert r.headers["cache-control"] == "public, max-age=86400" and "content-length" in r.headers


def test_frame_out_of_range_and_unknown_404(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path, 1)
    assert client.get(_url(d, d[0].SOPInstanceUID) + "/frames/2").status_code == 404
    assert client.get(_url(d, "9.9") + "/frames/1").status_code == 404
    assert client.get("/dicomweb/studies/1/series/2/metadata").status_code == 404


def test_instance_download_is_valid_dicom(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path, 1)
    r = client.get(_url(d, d[0].SOPInstanceUID))
    assert r.headers["content-type"].startswith('multipart/related; type="application/dicom"')
    _, _, rest = r.content.partition(b"\r\n\r\n")
    boundary = r.headers["content-type"].split("boundary=")[1].strip('"')
    dcm_bytes = rest.rsplit(f"\r\n--{boundary}--".encode(), 1)[0]
    ds = pydicom.dcmread(io.BytesIO(dcm_bytes))
    assert ds.SOPInstanceUID == d[0].SOPInstanceUID


def test_rendered_png_thumbnail(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path, 1)
    r = client.get(_url(d, d[0].SOPInstanceUID) + "/rendered", params={"viewport": "8,8"})
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    img = Image.open(io.BytesIO(r.content))
    assert img.size == (8, 8) and img.mode == "L"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_wado.py -v`
Expected: FAIL — 404s (routes missing).

- [ ] **Step 3: Implement `multipart.py` and `wado.py`, include router**

`backend/app/dicomweb/multipart.py`:

```python
from __future__ import annotations

import uuid


def multipart_related(parts: list[tuple[str, bytes]]) -> tuple[bytes, str]:
    """Build a multipart/related body. parts = [(media_type, payload), ...]. Returns (body, content_type)."""
    boundary = uuid.uuid4().hex
    chunks: list[bytes] = []
    for media_type, payload in parts:
        chunks.append(f"--{boundary}\r\nContent-Type: {media_type}\r\n\r\n".encode() + payload + b"\r\n")
    chunks.append(f"--{boundary}--".encode())
    body = b"".join(chunks)
    content_type = f'multipart/related; type="{parts[0][0]}"; boundary={boundary}'
    return body, content_type
```

`backend/app/dicomweb/wado.py`:

```python
from __future__ import annotations

import io
import sqlite3
from pathlib import Path

import numpy as np
import pydicom
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from PIL import Image
from pydicom.uid import ExplicitVRLittleEndian

from app import repo
from app.dicomweb.deps import DICOM_JSON, get_db
from app.dicomweb.json_model import dataset_to_dicom_json
from app.dicomweb.multipart import multipart_related
from app.geometry import sort_instances
from app.models import InstanceRow, SeriesRow, SortMethod

router = APIRouter(prefix="/dicomweb", tags=["wado"])
FRAME_CACHE = "public, max-age=86400"


def load_sorted_series(conn: sqlite3.Connection, study_uid: str, series_uid: str
                       ) -> tuple[SeriesRow, list[InstanceRow], SortMethod]:
    s = repo.get_series(conn, series_uid)
    if s is None or s.study_uid != study_uid:
        raise HTTPException(404, f"series {series_uid} not found in study {study_uid}")
    ordered, method = sort_instances(repo.list_instances(conn, series_uid))
    return s, ordered, method


def _instance_or_404(conn: sqlite3.Connection, study_uid: str, series_uid: str, sop_uid: str) -> InstanceRow:
    i = repo.get_instance(conn, sop_uid)
    if i is None or i.series_uid != series_uid:
        raise HTTPException(404, f"instance {sop_uid} not found")
    s = repo.get_series(conn, series_uid)
    if s is None or s.study_uid != study_uid:
        raise HTTPException(404, f"series {series_uid} not found in study {study_uid}")
    return i


@router.get("/studies/{study_uid}/series/{series_uid}/metadata")
def series_metadata(study_uid: str, series_uid: str, conn: sqlite3.Connection = Depends(get_db)) -> JSONResponse:
    _, ordered, method = load_sorted_series(conn, study_uid, series_uid)
    out = []
    for i in ordered:
        ds = pydicom.dcmread(i.path, stop_before_pixels=True)
        j = dataset_to_dicom_json(ds)
        j["00020010"] = {"vr": "UI", "Value": [str(ExplicitVRLittleEndian)]}
        out.append(j)
    return JSONResponse(out, media_type=DICOM_JSON, headers={"X-Sort-Method": method})


@router.get("/studies/{study_uid}/series/{series_uid}/instances/{sop_uid}/frames/{frame}")
def instance_frame(study_uid: str, series_uid: str, sop_uid: str, frame: int,
                   conn: sqlite3.Connection = Depends(get_db)) -> Response:
    i = _instance_or_404(conn, study_uid, series_uid, sop_uid)
    if frame < 1 or frame > i.num_frames:
        raise HTTPException(404, f"frame {frame} out of range 1..{i.num_frames}")
    ds = pydicom.dcmread(i.path)
    frame_len = i.rows * i.cols * i.samples_per_pixel * (i.bits_allocated // 8)
    start = (frame - 1) * frame_len
    payload = bytes(ds.PixelData[start : start + frame_len])
    body, ct = multipart_related([("application/octet-stream", payload)])
    return Response(body, media_type=ct, headers={"Cache-Control": FRAME_CACHE, "Content-Length": str(len(body))})


@router.get("/studies/{study_uid}/series/{series_uid}/instances/{sop_uid}")
def instance_file(study_uid: str, series_uid: str, sop_uid: str, conn: sqlite3.Connection = Depends(get_db)) -> Response:
    i = _instance_or_404(conn, study_uid, series_uid, sop_uid)
    body, ct = multipart_related([("application/dicom", Path(i.path).read_bytes())])
    return Response(body, media_type=ct, headers={"Cache-Control": FRAME_CACHE})


def _window(ds: pydicom.Dataset, arr: np.ndarray) -> np.ndarray:
    slope, intercept = float(ds.get("RescaleSlope", 1)), float(ds.get("RescaleIntercept", 0))
    hu = arr.astype(np.float32) * slope + intercept
    wc, ww = ds.get("WindowCenter"), ds.get("WindowWidth")
    if wc is None or ww is None:
        lo, hi = float(hu.min()), float(hu.max())
    else:
        c = float(wc[0] if isinstance(wc, pydicom.multival.MultiValue) else wc)
        w = float(ww[0] if isinstance(ww, pydicom.multival.MultiValue) else ww)
        lo, hi = c - w / 2, c + w / 2
    scaled = np.clip((hu - lo) / max(hi - lo, 1e-6), 0, 1) * 255
    if ds.get("PhotometricInterpretation") == "MONOCHROME1":
        scaled = 255 - scaled
    return scaled.astype(np.uint8)


@router.get("/studies/{study_uid}/series/{series_uid}/instances/{sop_uid}/rendered")
def instance_rendered(study_uid: str, series_uid: str, sop_uid: str,
                      viewport: str = Query("128,128", pattern=r"^\d+,\d+$"),
                      conn: sqlite3.Connection = Depends(get_db)) -> Response:
    i = _instance_or_404(conn, study_uid, series_uid, sop_uid)
    ds = pydicom.dcmread(i.path)
    arr = ds.pixel_array
    if arr.ndim == 3 and i.num_frames > 1:
        arr = arr[i.num_frames // 2]
    img = Image.fromarray(_window(ds, arr), mode="L")
    w, h = (int(v) for v in viewport.split(","))
    img = img.resize((w, h), Image.Resampling.BILINEAR)
    buf = io.BytesIO(); img.save(buf, format="PNG")
    return Response(buf.getvalue(), media_type="image/png", headers={"Cache-Control": FRAME_CACHE})
```

In `backend/app/main.py`, add `from app.dicomweb import qido, wado` and `app.include_router(wado.router)`.

- [ ] **Step 4: Run tests and linters**

Run: `python -m pytest tests/test_wado.py -v; ruff check .; mypy app/`
Expected: 5 passed; clean. If the `pixel_array` for a colour image trips `mode="L"`, that is out of v1 scope — samples are monochrome.

---

### Task 11: Volume-info API

**Files:**
- Create: `backend/app/api/volume.py`, `backend/tests/test_volume_api.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Produces: `GET /api/series/{series_uid}/volume-info` → JSON exactly as spec §4.6 (`seriesUid, isVolume, reason, dims, spacing, origin, direction, modality, sortMethod, instanceCount, estimatedBytes`). Frontend `api/types.ts` mirrors this shape.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_volume_api.py`:

```python
from pathlib import Path

from app.ingest.indexer import ingest_directory
from tests.conftest import make_ct_series, write_series


def _seed(client, tmp_path: Path, n=4, **kw):
    d = make_ct_series(n, **kw)
    write_series(d, tmp_path / "in")
    ingest_directory(client.app.state.db, tmp_path / "in", client.app.state.settings.store_dir)
    return d


def test_volume_info_for_volume(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path, 6)
    r = client.get(f"/api/series/{d[0].SeriesInstanceUID}/volume-info")
    assert r.status_code == 200
    j = r.json()
    assert j == {
        "seriesUid": d[0].SeriesInstanceUID, "isVolume": True, "reason": None,
        "dims": [16, 16, 6], "spacing": [0.5, 0.5, 1.0], "origin": [0.0, 0.0, 0.0],
        "direction": [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
        "modality": "CT", "sortMethod": "geometry", "instanceCount": 6,
        "estimatedBytes": 16 * 16 * 6 * 2,
    }


def test_volume_info_for_non_volume(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path, 2)
    j = client.get(f"/api/series/{d[0].SeriesInstanceUID}/volume-info").json()
    assert j["isVolume"] is False and j["reason"] == "fewer than 3 slices"
    assert j["dims"] is None and j["estimatedBytes"] is None and j["instanceCount"] == 2


def test_unknown_series_404(client) -> None:
    assert client.get("/api/series/9.9/volume-info").status_code == 404
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_volume_api.py -v`
Expected: FAIL — 404 for the first two tests.

- [ ] **Step 3: Implement `volume.py`, include router**

```python
from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app import repo
from app.dicomweb.deps import get_db

router = APIRouter(prefix="/api", tags=["volume"])


@router.get("/series/{series_uid}/volume-info")
def volume_info(series_uid: str, conn: sqlite3.Connection = Depends(get_db)) -> dict[str, Any]:
    s = repo.get_series(conn, series_uid)
    if s is None:
        raise HTTPException(404, f"series {series_uid} not found")
    v = s.volume
    est = None
    if v.dims:
        first = repo.list_instances(conn, series_uid)[0]
        est = v.dims[0] * v.dims[1] * v.dims[2] * (first.bits_allocated // 8) * first.samples_per_pixel
    return {
        "seriesUid": s.series_uid, "isVolume": v.is_volume, "reason": v.reason,
        "dims": list(v.dims) if v.dims else None, "spacing": list(v.spacing) if v.spacing else None,
        "origin": list(v.origin) if v.origin else None,
        "direction": list(v.direction) if v.direction else None,
        "modality": s.modality, "sortMethod": s.sort_method, "instanceCount": s.instance_count,
        "estimatedBytes": est,
    }
```

In `main.py`: `from app.api import health, volume` and `app.include_router(volume.router)`.

- [ ] **Step 4: Run tests and linters**

Run: `python -m pytest tests/test_volume_api.py -v; ruff check .; mypy app/`
Expected: 3 passed; clean.

---

### Task 12: Upload API

**Files:**
- Create: `backend/app/api/upload.py`, `backend/tests/test_upload.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Produces: `POST /api/upload` (multipart form, field name `files`, repeated) → `200 {"accepted": int, "skipped": [{"file","reason"}], "studyUids": [..]}`; `400` on bad zip; `413` on size.

- [ ] **Step 1: Write the failing tests**

`backend/tests/test_upload.py`:

```python
import io
import zipfile
from pathlib import Path

from tests.conftest import make_ct_series, write_series


def _files(paths: list[Path]):
    return [("files", (p.name, p.read_bytes(), "application/dicom")) for p in paths]


def test_upload_dicom_files(client, tmp_path: Path) -> None:
    d = make_ct_series(3)
    paths = write_series(d, tmp_path / "up")
    r = client.post("/api/upload", files=_files(paths))
    assert r.status_code == 200
    assert r.json() == {"accepted": 3, "skipped": [], "studyUids": [d[0].StudyInstanceUID]}
    assert len(client.get("/dicomweb/studies").json()) == 1


def test_upload_zip_with_mixed_content(client, tmp_path: Path) -> None:
    d = make_ct_series(3)
    paths = write_series(d, tmp_path / "up")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for p in paths:
            z.write(p, f"sub/{p.name}")
        z.writestr("README.txt", "not dicom")
    r = client.post("/api/upload", files=[("files", ("s.zip", buf.getvalue(), "application/zip"))])
    j = r.json()
    assert r.status_code == 200 and j["accepted"] == 3
    assert j["skipped"] == [{"file": "README.txt", "reason": j["skipped"][0]["reason"]}] and "README" in j["skipped"][0]["file"]


def test_zip_path_traversal_rejected(client) -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("../evil.dcm", b"x")
    r = client.post("/api/upload", files=[("files", ("s.zip", buf.getvalue(), "application/zip"))])
    assert r.status_code == 400


def test_too_large_rejected(client) -> None:
    big = b"\0" * (6 * 1024 * 1024)  # settings fixture sets max_upload_mb=5
    r = client.post("/api/upload", files=[("files", ("big.dcm", big, "application/dicom"))])
    assert r.status_code == 413
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_upload.py -v`
Expected: FAIL — 404/405.

- [ ] **Step 3: Implement `upload.py`, include router**

```python
from __future__ import annotations

import shutil
import sqlite3
import tempfile
import zipfile
from dataclasses import asdict
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile

from app.config import Settings
from app.dicomweb.deps import get_db, get_settings_dep
from app.ingest.indexer import ingest_files

router = APIRouter(prefix="/api", tags=["upload"])


def _safe_extract(zf: zipfile.ZipFile, dest: Path) -> list[Path]:
    out: list[Path] = []
    for info in zf.infolist():
        name = PurePosixPath(info.filename)
        if name.is_absolute() or ".." in name.parts:
            raise HTTPException(400, f"zip entry has an unsafe path: {info.filename}")
        if info.is_dir():
            continue
        target = dest / Path(*name.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, target.open("wb") as dst:
            shutil.copyfileobj(src, dst)
        out.append(target)
    return out


@router.post("/upload")
async def upload(files: list[UploadFile], conn: sqlite3.Connection = Depends(get_db),
                 settings: Settings = Depends(get_settings_dep)) -> dict[str, Any]:
    limit = settings.max_upload_mb * 1024 * 1024
    total = 0
    tmp = Path(tempfile.mkdtemp(prefix="upload-"))
    try:
        paths: list[Path] = []
        for f in files:
            data = await f.read()
            total += len(data)
            if total > limit:
                raise HTTPException(413, f"upload exceeds {settings.max_upload_mb} MB")
            name = Path(f.filename or "file").name
            p = tmp / name
            p.write_bytes(data)
            if name.lower().endswith(".zip"):
                try:
                    with zipfile.ZipFile(p) as zf:
                        paths.extend(_safe_extract(zf, tmp / f"{name}.d"))
                except zipfile.BadZipFile as e:
                    raise HTTPException(400, f"{name}: not a valid zip") from e
            else:
                paths.append(p)
        summary = ingest_files(conn, paths, settings.store_dir)
        return {"accepted": summary.accepted, "skipped": [asdict(s) for s in summary.skipped],
                "studyUids": summary.study_uids}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
```

In `main.py`: `from app.api import health, upload, volume` and `app.include_router(upload.router)`.

- [ ] **Step 4: Run tests and linters**

Run: `python -m pytest tests/test_upload.py -v; ruff check .; mypy app/`
Expected: 4 passed; clean.

---

### Task 13: App factory with startup ingest, dev scripts, `.env.example`

**Files:**
- Modify: `backend/app/main.py`
- Create: `backend/tests/test_main.py`, `scripts/dev.ps1`, `scripts/test.ps1`, `.env.example` (repo root)

**Interfaces:**
- Produces: final `create_app()`; on startup, `ingest_directory(SAMPLES_DIR)` runs if the directory exists. `scripts/dev.ps1` starts uvicorn on `:8000` (frontend plan adds Vite to it). `scripts/test.ps1` runs pytest (frontend plan appends vitest).

- [ ] **Step 1: Write the failing test**

`backend/tests/test_main.py`:

```python
from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import make_ct_series, write_series


def test_startup_ingests_samples_dir(settings) -> None:
    d = make_ct_series(3)
    write_series(d, settings.samples_dir / "ct")
    with TestClient(create_app(settings)) as c:
        studies = c.get("/dicomweb/studies").json()
        assert [s["0020000D"]["Value"][0] for s in studies] == [d[0].StudyInstanceUID]


def test_startup_without_samples_dir_is_fine(settings) -> None:
    with TestClient(create_app(settings)) as c:
        assert c.get("/dicomweb/studies").json() == []


def test_cors_headers(settings) -> None:
    with TestClient(create_app(settings)) as c:
        r = c.options("/api/health", headers={"Origin": "http://localhost:5173",
                                                "Access-Control-Request-Method": "GET"})
        assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python -m pytest tests/test_main.py -v`
Expected: first test FAILS (no startup ingest yet).

- [ ] **Step 3: Finalise `main.py`**

Replace `backend/app/main.py` with:

```python
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, upload, volume
from app.config import Settings, get_settings
from app.db import connect, init_schema
from app.dicomweb import qido, wado
from app.ingest.indexer import ingest_directory

log = logging.getLogger("dicomviewer")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if settings.samples_dir.is_dir():
            summary = ingest_directory(app.state.db, settings.samples_dir, settings.store_dir)
            log.info("samples ingested: %d accepted, %d skipped", summary.accepted, len(summary.skipped))
        yield
        app.state.db.close()

    app = FastAPI(title="DICOM 3D Web Viewer API", lifespan=lifespan)
    app.state.settings = settings
    conn = connect(settings.db_path)
    init_schema(conn)
    app.state.db = conn
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"],
        allow_headers=["*"], expose_headers=["X-Sort-Method", "Content-Length"],
    )
    for r in (health.router, volume.router, upload.router, qido.router, wado.router):
        app.include_router(r)
    return app


app = create_app()
```

`scripts/dev.ps1` (repo root `scripts/`):

```powershell
# Starts the backend (and, once Part 2 is done, the frontend). Run from repo root.
$root = Split-Path -Parent $PSScriptRoot
Start-Process powershell -ArgumentList "-NoExit","-Command","Set-Location '$root\backend'; .\.venv\Scripts\Activate.ps1; uvicorn app.main:app --reload --port 8000"
if (Test-Path "$root\frontend\package.json") {
  Start-Process powershell -ArgumentList "-NoExit","-Command","Set-Location '$root\frontend'; npm run dev"
}
```

`scripts/test.ps1`:

```powershell
$root = Split-Path -Parent $PSScriptRoot
Set-Location "$root\backend"; .\.venv\Scripts\Activate.ps1
python -m pytest -q; if (-not $?) { exit 1 }
ruff check .; if (-not $?) { exit 1 }
mypy app/; if (-not $?) { exit 1 }
if (Test-Path "$root\frontend\package.json") {
  Set-Location "$root\frontend"; npm test -- --run; if (-not $?) { exit 1 }
}
```

`.env.example` (repo root):

```
# Backend
STORE_DIR=./data/store
SAMPLES_DIR=./data/samples
DB_PATH=./data/store/index.sqlite
MAX_UPLOAD_MB=500
CORS_ORIGINS=http://localhost:5173
# Frontend
VITE_API_URL=http://localhost:8000
```

- [ ] **Step 4: Run the whole backend suite and linters**

Run: `python -m pytest -v; ruff check .; mypy app/`
Expected: all tests pass; clean.

- [ ] **Step 5: Smoke-run the server**

Run (from repo root): `.\scripts\dev.ps1`, then in another shell `curl http://localhost:8000/api/health` → `{"status":"ok"}` and open `http://localhost:8000/docs` to see the five routers. Stop the server.

---

### Task 14: `fetch_samples.py` and manifest

**Files:**
- Create: `scripts/samples.json`, `scripts/fetch_samples.py`, `scripts/test_fetch_samples.py`

**Interfaces:**
- Produces: `data/samples/ct-chest-lidc/*.dcm` (uncompressed) and `data/samples/mr-brain-upenn-j2k/*.dcm` (JPEG 2000 Lossless). Pure helpers `verify_series(dir, expected_uid, expected_count) -> None` and `transcode_to_j2k(src: Path, dst: Path) -> None` are unit-tested with synthetic data; the network path is exercised only by running the script manually.

- [ ] **Step 1: Write the manifest**

`scripts/samples.json`:

```json
[
  {
    "id": "ct-chest-lidc",
    "title": "CT chest (LIDC-IDRI-0365)",
    "source": "https://services.cancerimagingarchive.net/nbia-api/services/v1/getImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.6279.6001.207544473852086582434957174616",
    "series_uid": "1.3.6.1.4.1.14519.5.2.1.6279.6001.207544473852086582434957174616",
    "expected_count": 101,
    "transcode": null,
    "license": "CC BY 3.0 — https://doi.org/10.7937/K9/TCIA.2015.LO9QL9SX"
  },
  {
    "id": "mr-brain-upenn-j2k",
    "title": "MR brain T1 MPRAGE (UPENN-GBM-00041), transcoded to JPEG 2000 Lossless",
    "source": "https://services.cancerimagingarchive.net/nbia-api/services/v1/getImage?SeriesInstanceUID=1.3.6.1.4.1.14519.5.2.1.238667833945377278535172479340077807244",
    "series_uid": "1.3.6.1.4.1.14519.5.2.1.238667833945377278535172479340077807244",
    "expected_count": 160,
    "transcode": "1.2.840.10008.1.2.4.90",
    "license": "CC BY 4.0 — https://doi.org/10.7937/TCIA.709X-DN49"
  }
]
```

- [ ] **Step 2: Write the failing tests for the pure helpers**

`scripts/test_fetch_samples.py` (run with the backend venv from the repo root: `python -m pytest scripts -q`; it imports the backend test fixtures via path):

```python
import sys
from pathlib import Path

import numpy as np
import pydicom
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from fetch_samples import transcode_to_j2k, verify_series  # noqa: E402
from tests.conftest import make_ct_series, write_series  # noqa: E402


def test_verify_series_ok_and_mismatch(tmp_path: Path) -> None:
    d = make_ct_series(3)
    write_series(d, tmp_path)
    verify_series(tmp_path, d[0].SeriesInstanceUID, 3)
    with pytest.raises(SystemExit):
        verify_series(tmp_path, d[0].SeriesInstanceUID, 4)
    with pytest.raises(SystemExit):
        verify_series(tmp_path, "9.9", 3)


def test_transcode_preserves_pixels(tmp_path: Path) -> None:
    (src,) = write_series(make_ct_series(1), tmp_path / "in")
    dst = tmp_path / "out" / "a.dcm"
    transcode_to_j2k(src, dst)
    a, b = pydicom.dcmread(src), pydicom.dcmread(dst)
    assert b.file_meta.TransferSyntaxUID == "1.2.840.10008.1.2.4.90"
    assert np.array_equal(a.pixel_array, b.pixel_array)
```

- [ ] **Step 3: Run tests to verify they fail**

Run (repo root, venv active): `python -m pytest scripts -q`
Expected: FAIL with `ModuleNotFoundError: No module named 'fetch_samples'`.

- [ ] **Step 4: Implement `fetch_samples.py`**

```python
"""Download the bundled public sample studies into data/samples/ (run once).

Usage (repo root, backend venv active):  python scripts/fetch_samples.py [--force]
"""
from __future__ import annotations

import argparse
import io
import json
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import pydicom
from pydicom.uid import JPEG2000Lossless

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "scripts" / "samples.json"
SAMPLES = ROOT / "data" / "samples"


def verify_series(directory: Path, expected_uid: str, expected_count: int) -> None:
    files = sorted(directory.glob("*.dcm"))
    if len(files) != expected_count:
        sys.exit(f"{directory.name}: expected {expected_count} files, found {len(files)}")
    for f in files:
        ds = pydicom.dcmread(f, stop_before_pixels=True)
        if str(ds.SeriesInstanceUID) != expected_uid:
            sys.exit(f"{directory.name}: {f.name} belongs to series {ds.SeriesInstanceUID}")


def transcode_to_j2k(src: Path, dst: Path) -> None:
    ds = pydicom.dcmread(src)
    before = ds.pixel_array.copy()
    ds.compress(JPEG2000Lossless)
    if not np.array_equal(ds.pixel_array, before):
        sys.exit(f"{src.name}: JPEG 2000 transcode changed pixel values")
    dst.parent.mkdir(parents=True, exist_ok=True)
    pydicom.dcmwrite(dst, ds, enforce_file_format=True)


def download_zip(url: str) -> bytes:
    print(f"  downloading {url}")
    with urllib.request.urlopen(url, timeout=600) as r:  # noqa: S310 - fixed https URLs from manifest
        return r.read()


def fetch(entry: dict[str, object], force: bool) -> None:
    out = SAMPLES / str(entry["id"])
    if out.exists() and not force:
        print(f"[skip] {entry['id']} already present")
        verify_series(out, str(entry["series_uid"]), int(entry["expected_count"]))
        return
    print(f"[fetch] {entry['title']}")
    data = download_zip(str(entry["source"]))
    tmp = Path(tempfile.mkdtemp(prefix="samples-"))
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            zf.extractall(tmp)
        dcms = sorted(p for p in tmp.rglob("*") if p.is_file() and p.suffix.lower() in (".dcm", ""))
        if out.exists():
            shutil.rmtree(out)
        out.mkdir(parents=True)
        for k, p in enumerate(dcms):
            dst = out / f"{k:04d}.dcm"
            if entry["transcode"]:
                transcode_to_j2k(p, dst)
            else:
                shutil.copyfile(p, dst)
        verify_series(out, str(entry["series_uid"]), int(entry["expected_count"]))
        (out / "LICENSE.txt").write_text(f"{entry['title']}\n{entry['license']}\nSource: {entry['source']}\n")
        print(f"  ok: {len(dcms)} files -> {out}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-download even if present")
    args = ap.parse_args()
    for entry in json.loads(MANIFEST.read_text()):
        fetch(entry, args.force)


if __name__ == "__main__":
    main()
```

- [ ] **Step 5: Run the helper tests**

Run: `python -m pytest scripts -q`
Expected: 2 passed.

- [ ] **Step 6: Run the real fetch once and verify ingest**

Run (repo root, venv active): `python scripts/fetch_samples.py`
Expected: two `ok:` lines (≈70 MB total download). Then start the backend (`.\scripts\dev.ps1`) and check:

```powershell
curl http://localhost:8000/dicomweb/studies
```

Expected: two studies. For each series, `curl http://localhost:8000/api/series/<series_uid>/volume-info` shows `"isVolume": true` — CT dims `[512, 512, 101]`, MR dims with `dim_z = 160`. If either reports `"irregular slice spacing"`, inspect the gaps with a one-off pydicom script and, if the source data is genuinely irregular, pick the next candidate series from the same collection (the TCIA `getSeries?Collection=LIDC-IDRI&Modality=CT` / `Collection=UPENN-GBM&Modality=MR` endpoints list alternatives) and update `samples.json`.

---

## Self-review (done while writing)

- **Spec coverage:** §4.1 layout (+ `repo.py`, `deps.py`, `multipart.py` added for clean boundaries) → Tasks 1–12; §4.2 pipeline → Tasks 2–4, 7; §4.3 schema → Task 1 (+ origin/direction columns needed by §4.6); §4.4 geometry → Task 5; §4.5 DICOMweb → Tasks 9–10; §4.6 volume-info → Task 11; §4.7 JSON model → Task 8; §4.8 upload → Task 12; §4.9 errors → Tasks 9–12; §6 backend tests → every task; §7 samples → Task 14; §8 tooling → Tasks 1, 13.
- **Deviation noted:** `volume_info` takes `(rows, method)` rather than the spec's `(sorted_rows)`; multi-frame series are reported as non-volumes in v1 (spacing for enhanced multi-frame needs per-frame functional groups, out of scope).
- **Type consistency:** `InstanceRow`/`SeriesRow`/`VolumeInfo` field names are identical across `models.py`, `repo.py`, `indexer.py`, `wado.py`, `volume.py`; `SortMethod` literals match the `X-Sort-Method` header values and the `reason` strings match §4.4 exactly.
