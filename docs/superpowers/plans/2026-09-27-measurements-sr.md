# Measurements with DICOM SR Export - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user measure on the MPR planes and persist those measurements as a real DICOM Structured Report stored, indexed and served alongside the images.

**Architecture:** The frontend posts measurements as plain JSON in world coordinates; the backend builds a Comprehensive 3D SR with `highdicom`, writes it into `data/store` as its own SR series, and parses it back on read. No DICOM parsing is added to the browser.

**Tech Stack:** Python 3.12, FastAPI, pydicom 3, highdicom 0.28.1, SQLite. React 19, TypeScript 6 strict, Cornerstone3D 5.10 tools, TanStack Query 5, vitest + MSW, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-measurements-dicom-sr-design.md`

## Global Constraints

- **Verification is batched, by explicit user instruction.** Each task writes and runs only its own new tests as part of its TDD cycle. Do NOT run the full suite, lint, typecheck or e2e between tasks, and do not write a verification report per task. Task 9 runs everything once.
- Backend: `mypy --strict` clean over `app/`, `ruff` clean. All SQL lives in `app/repo.py`. Domain logic in `app/sr/` has no HTTP and no SQL imports.
- Frontend: TypeScript `strict`, `oxlint` clean, Prettier formatted. Only `src/cornerstone/*` may import from `@cornerstonejs/*`.
- Zero em-dash characters in any user-visible string (the UI copy rule established in commit 6f81f76).
- Commit after every task. Branch is `feature/dicom-viewer`. Never push, never merge to main.
- `highdicom==0.28.1` is already installed in `backend/.venv`; Task 1 adds it to `pyproject.toml`.

## Verified API facts

These were confirmed by introspection against the installed libraries. Do not
substitute other names; they were checked because the obvious guesses were wrong.

| Need | Correct name | Note |
|---|---|---|
| Length concept | `codes.SCT.Length` (410668003) | `codes.DCM.Length` does not exist |
| Angle concept | `codes.SCT.Angle` (1483009) | |
| Area concept | `codes.SCT.Area` (42798000) | |
| Mean concept | `codes.SCT.Mean` (373098007) | `codes.DCM.Mean` does not exist |
| Std dev concept | `codes.SCT.StandardDeviation` (386136009) | |
| Millimetre unit | `codes.UCUM.Millimeter` (mm) | `codes.UCUM.mm` does not exist |
| Degree unit | `codes.UCUM.Degree` (deg) | `codes.UCUM.degree` does not exist |
| Square mm unit | `codes.UCUM.SquareMillimeter` (mm2) | |
| Unitless | `codes.UCUM.NoUnits` (1) | |
| Report title | `codes.DCM.ImagingMeasurementReport` (126000) | |

Constructor signatures, verified:

```python
hd.sr.TrackingIdentifier(uid=None, identifier=None)
hd.sr.Measurement(name, value, unit, ..., referenced_coordinates=None)
hd.sr.CoordinatesForMeasurement3D(graphic_type, graphic_data, frame_of_reference_uid, ...)
hd.sr.ImageRegion3D(graphic_type, graphic_data, frame_of_reference_uid)
hd.sr.MeasurementsAndQualitativeEvaluations(tracking_identifier, ..., measurements=None)
hd.sr.PlanarROIMeasurementsAndQualitativeEvaluations(tracking_identifier, referenced_region=None, ..., measurements=None)
hd.sr.MeasurementReport(observation_context, procedure_reported, imaging_measurements=None, title=None)
hd.sr.Comprehensive3DSR(evidence, content, series_instance_uid, series_number,
                        sop_instance_uid, instance_number, manufacturer=None, ...)
hd.sr.GraphicTypeValues3D.{POINT,POLYLINE,ELLIPSE,ELLIPSOID,MULTIPOINT,POLYGON}
```

`Comprehensive3DSR.from_dataset(ds)` exists. We do **not** use it for parsing;
Task 2 walks `ContentSequence` with pydicom directly, because we only ever parse
reports we wrote and an explicit walk is testable and predictable.

## Two breakages the spec did not anticipate

Found while reading `repo.py` and `api/volume.py`. Both are handled in Task 1.

1. **`repo.upsert_instance` uses a positional `INSERT OR REPLACE INTO instance VALUES (?,?,...)` with exactly 16 placeholders.** Adding `sop_class_uid` makes the table 17 columns and this statement fails at runtime. It must become a named-column insert.
2. **`api/volume.py::volume_info` computes `first.bits_allocated // 8 * first.samples_per_pixel`.** Once those fields are `int | None`, a series whose first instance is non-image raises `TypeError`. It needs a guard.

---

## File Structure

**Backend, created**

| File | Responsibility |
|---|---|
| `app/sr/__init__.py` | Re-exports `build_sr`, `parse_sr`, `validate_set`, the wire dataclasses and the two error types. |
| `app/sr/models.py` | Wire dataclasses: `MeasurementValue`, `Plane`, `MeasurementItem`, `MeasurementSet`. No I/O. |
| `app/sr/build.py` | `build_sr(...) -> Dataset`. Pure. |
| `app/sr/parse.py` | `parse_sr(ds) -> list[MeasurementItem]`, `SrParseError`. Pure. |
| `app/sr/validate.py` | `validate_set(set_) -> None`, `SrValidationError`. Pure geometry checks. |
| `app/api/measurements.py` | `GET` and `PUT` routes. No SR logic, no SQL. |
| `tests/test_sr_build_parse.py` | Round trips and dataset assertions. |
| `tests/test_sr_validate.py` | One test per rejection. |
| `tests/test_measurements_api.py` | Endpoint behaviour, 409, parseError. |
| `tests/test_non_image_instances.py` | Ingest, schema migration, volume-info guard. |

**Backend, modified**

| File | Change |
|---|---|
| `app/db.py` | Two columns in `SCHEMA`, an index, and `_migrate()` called from `init_schema`. |
| `app/models.py` | `InstanceRow` image fields become `int \| None`; add `sop_class_uid`. `SeriesRow` gains `derived_from_series_uid`. |
| `app/repo.py` | Named-column `upsert_instance`; `upsert_series` writes the new column; add `find_derived_series`, `set_derived_from`, `delete_instance`. |
| `app/ingest/reader.py` | Two required-tag sets, image versus SR. |
| `app/ingest/indexer.py` | Tolerate missing image tags; non-image series reason. |
| `app/api/volume.py` | Guard `estimatedBytes`. |
| `app/main.py` | Register `measurements.router`. |
| `pyproject.toml` | Add `highdicom>=0.28,<0.29`. |

**Frontend, created**

| File | Responsibility |
|---|---|
| `src/api/measurements.ts` | `getMeasurements`, `putMeasurements`. Transport only. |
| `src/cornerstone/annotations.ts` | The only module touching Cornerstone annotation state. `toWire`, `fromWire`, `loadAnnotations`, `readAnnotations`, `clearAnnotations`. |
| `src/hooks/useMeasurements.ts` | Load, dirty tracking, save, error surfacing. |
| `src/cornerstone/annotations.test.ts` | Conversion both directions. |
| `src/hooks/useMeasurements.test.tsx` | Dirty tracking and save. |

**Frontend, modified**

| File | Change |
|---|---|
| `src/api/types.ts` | Wire types. |
| `src/cornerstone/toolGroups.ts` | Register the four tools; replace `setCrosshairsActive` with `setActiveMprTool`. |
| `src/components/viewer/Toolbar.tsx` | Tool mode selector, Save, Download. |
| `src/components/viewer/ViewerLayout.tsx` | Thread tool mode and measurement state. |
| `src/components/viewer/ViewerPage.tsx` | Call `useMeasurements`, surface `parseError`. |
| `src/test/msw.ts` | Measurement handlers. |
| `e2e/viewer.spec.ts` | New persistence test. |

---

## Task 1: Non-image instances in the store

**Files:**
- Modify: `backend/app/db.py`, `backend/app/models.py`, `backend/app/repo.py`, `backend/app/ingest/reader.py`, `backend/app/ingest/indexer.py`, `backend/app/api/volume.py`, `backend/pyproject.toml`
- Test: `backend/tests/test_non_image_instances.py`

**Interfaces:**
- Consumes: nothing.
- Produces: `InstanceRow.sop_class_uid: str | None`; `InstanceRow.rows/cols/bits_allocated/pixel_representation/samples_per_pixel/num_frames: int | None`; `SeriesRow.derived_from_series_uid: str | None`; `repo.find_derived_series(conn, parent_series_uid, modality) -> SeriesRow | None`; `reader.SR_SOP_CLASSES: frozenset[str]`.

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_non_image_instances.py`:

```python
from __future__ import annotations

import sqlite3
from pathlib import Path

import pydicom
import pytest
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

from app import repo
from app.db import connect, init_schema
from app.ingest.indexer import ingest_files
from app.ingest.reader import NotDicomError, read_dicom

COMPREHENSIVE_3D_SR = "1.2.840.10008.5.1.4.1.1.88.34"


def make_sr(tmp_path: Path, study_uid: str, series_uid: str) -> Path:
    """A minimal SR: no PixelData, no Rows/Columns, but a ContentSequence."""
    ds = Dataset()
    ds.SOPClassUID = COMPREHENSIVE_3D_SR
    ds.SOPInstanceUID = generate_uid()
    ds.SeriesInstanceUID = series_uid
    ds.StudyInstanceUID = study_uid
    ds.Modality = "SR"
    ds.SeriesNumber = 99
    ds.InstanceNumber = 1
    item = Dataset()
    item.RelationshipType = "CONTAINS"
    item.ValueType = "TEXT"
    item.TextValue = "placeholder"
    ds.ContentSequence = [item]
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = ds.SOPClassUID
    ds.file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
    path = tmp_path / "sr.dcm"
    pydicom.dcmwrite(path, ds, enforce_file_format=True)
    return path


def test_read_dicom_accepts_sr_without_pixeldata(tmp_path: Path) -> None:
    path = make_sr(tmp_path, generate_uid(), generate_uid())
    ds = read_dicom(path)
    assert ds.Modality == "SR"


def test_read_dicom_still_rejects_an_image_without_pixeldata(tmp_path: Path) -> None:
    ds = Dataset()
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.2"  # CT Image Storage
    ds.SOPInstanceUID = generate_uid()
    ds.SeriesInstanceUID = generate_uid()
    ds.StudyInstanceUID = generate_uid()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = ds.SOPClassUID
    ds.file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
    path = tmp_path / "broken.dcm"
    pydicom.dcmwrite(path, ds, enforce_file_format=True)
    with pytest.raises(NotDicomError, match="PixelData"):
        read_dicom(path)


def test_sr_is_ingested_into_its_own_series(tmp_path: Path, settings) -> None:
    conn = connect(settings.db_path)
    init_schema(conn)
    study_uid, series_uid = generate_uid(), generate_uid()
    path = make_sr(tmp_path, study_uid, series_uid)

    summary = ingest_files(conn, [path], settings.store_dir)

    assert summary.accepted == 1
    assert summary.skipped == []
    series = repo.get_series(conn, series_uid)
    assert series is not None
    assert series.modality == "SR"
    assert series.volume.is_volume is False
    assert series.volume.reason == "structured report, not an image series"
    assert series.thumb_sop_uid is None
    inst = repo.list_instances(conn, series_uid)[0]
    assert inst.sop_class_uid == COMPREHENSIVE_3D_SR
    assert inst.rows is None
    assert inst.bits_allocated is None
    conn.close()


def test_migration_adds_columns_to_an_existing_database(tmp_path: Path) -> None:
    db = tmp_path / "old.sqlite"
    conn = sqlite3.connect(db)
    conn.executescript(
        """CREATE TABLE instance (sop_uid TEXT PRIMARY KEY, series_uid TEXT, path TEXT);
           CREATE TABLE series (series_uid TEXT PRIMARY KEY, study_uid TEXT);
           INSERT INTO instance VALUES ('1.2', '1.3', 'p');"""
    )
    conn.commit()
    conn.close()

    conn = connect(db)
    init_schema(conn)
    cols_i = {r[1] for r in conn.execute("PRAGMA table_info(instance)")}
    cols_s = {r[1] for r in conn.execute("PRAGMA table_info(series)")}
    assert "sop_class_uid" in cols_i
    assert "derived_from_series_uid" in cols_s
    assert conn.execute("SELECT COUNT(*) FROM instance").fetchone()[0] == 1
    init_schema(conn)  # idempotent
    conn.close()


def test_volume_info_does_not_crash_for_a_non_image_series(client, tmp_path: Path) -> None:
    study_uid, series_uid = generate_uid(), generate_uid()
    path = make_sr(tmp_path, study_uid, series_uid)
    ingest_files(client.app.state.db, [path], client.app.state.settings.store_dir)

    r = client.get(f"/api/series/{series_uid}/volume-info")

    assert r.status_code == 200
    assert r.json()["isVolume"] is False
    assert r.json()["estimatedBytes"] is None
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_non_image_instances.py -v`
Expected: FAIL. `test_read_dicom_accepts_sr_without_pixeldata` fails with `NotDicomError: sr.dcm: missing PixelData`.

- [ ] **Step 3: Add the schema columns and migration**

In `backend/app/db.py`, add `sop_class_uid TEXT,` to the `instance` table in
`SCHEMA` (before `path TEXT NOT NULL`), add `derived_from_series_uid TEXT` to
the `series` table, add the index to the end of `SCHEMA`:

```sql
CREATE INDEX IF NOT EXISTS ix_series_derived ON series(derived_from_series_uid);
```

Then add the migration:

```python
# Columns added after the first release. `init_schema` only runs
# CREATE TABLE IF NOT EXISTS, which silently does nothing for a table that
# already exists, so an existing store would never gain these.
_ADDED_COLUMNS = (
    ("instance", "sop_class_uid", "TEXT"),
    ("series", "derived_from_series_uid", "TEXT"),
)


def _migrate(conn: sqlite3.Connection) -> None:
    for table, column, decl in _ADDED_COLUMNS:
        existing = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        if existing and column not in existing:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {decl}")


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    _migrate(conn)
    conn.commit()
```

Note the index creation must come after `_migrate` for an old database, so
either move the `CREATE INDEX` statement into `_migrate` or run
`conn.executescript(SCHEMA)` a second time after it. Prefer putting the index
line inside `_migrate` as a final `conn.execute`.

- [ ] **Step 4: Relax the models**

In `backend/app/models.py`, change `InstanceRow` so the image-only fields are
optional and add the discriminator. Keep field order: `sop_class_uid` goes
immediately before `path`, matching the column order used in step 5.

```python
@dataclass(frozen=True)
class InstanceRow:
    sop_uid: str
    series_uid: str
    instance_number: int | None
    rows: int | None
    cols: int | None
    bits_allocated: int | None
    pixel_representation: int | None
    samples_per_pixel: int | None
    num_frames: int | None
    ipp: tuple[float, float, float] | None
    iop: tuple[float, float, float, float, float, float] | None
    pixel_spacing: tuple[float, float] | None
    sop_class_uid: str | None
    path: str
    transfer_syntax: str
```

Add to `SeriesRow`, after `frame_count`:

```python
    derived_from_series_uid: str | None = None
```

- [ ] **Step 5: Rewrite the instance upsert with named columns**

In `backend/app/repo.py`, replace the positional `upsert_instance` body. The
old `INSERT OR REPLACE INTO instance VALUES (?,?,...)` had exactly 16
placeholders and breaks the moment the table has 17 columns.

```python
_INSTANCE_COLUMNS = (
    "sop_uid", "series_uid", "instance_number", "rows", "cols",
    "bits_allocated", "pixel_representation", "samples_per_pixel", "num_frames",
    "ipp_x", "ipp_y", "ipp_z", "iop", "pixel_spacing",
    "sop_class_uid", "path", "transfer_syntax",
)


def upsert_instance(conn: sqlite3.Connection, i: InstanceRow) -> None:
    ipp = i.ipp or (None, None, None)
    # Named columns, not `VALUES (?,...)`: a positional insert silently
    # couples this statement to the physical column order and breaks on
    # every future ALTER TABLE.
    cols = ", ".join(_INSTANCE_COLUMNS)
    marks = ", ".join("?" * len(_INSTANCE_COLUMNS))
    conn.execute(
        f"INSERT OR REPLACE INTO instance ({cols}) VALUES ({marks})",
        (
            i.sop_uid, i.series_uid, i.instance_number, i.rows, i.cols,
            i.bits_allocated, i.pixel_representation, i.samples_per_pixel, i.num_frames,
            ipp[0], ipp[1], ipp[2],
            "\\".join(map(str, i.iop)) if i.iop else None,
            "\\".join(map(str, i.pixel_spacing)) if i.pixel_spacing else None,
            i.sop_class_uid, i.path, i.transfer_syntax,
        ),
    )
```

Update `_instance_from_row` to read `r["sop_class_uid"]` into the new field.

Extend `upsert_series` to write the new column:

```python
def upsert_series(conn: sqlite3.Connection, s: SeriesRow) -> None:
    conn.execute(
        """INSERT INTO series (series_uid, study_uid, modality, series_desc,
                               series_number, derived_from_series_uid)
           VALUES (?,?,?,?,?,?)
           ON CONFLICT(series_uid) DO UPDATE SET modality=excluded.modality,
             series_desc=excluded.series_desc, series_number=excluded.series_number,
             derived_from_series_uid=COALESCE(excluded.derived_from_series_uid,
                                              series.derived_from_series_uid)""",
        (s.series_uid, s.study_uid, s.modality, s.series_desc, s.series_number,
         s.derived_from_series_uid),
    )
```

`COALESCE` matters: re-ingesting an SR must not blank an existing link.

Add three helpers, and update `_series_from_row` to populate the new field:

```python
def find_derived_series(
    conn: sqlite3.Connection, parent_series_uid: str, modality: str
) -> SeriesRow | None:
    r = conn.execute(
        "SELECT * FROM series WHERE derived_from_series_uid=? AND modality=?",
        (parent_series_uid, modality),
    ).fetchone()
    return _series_from_row(r) if r else None


def set_derived_from(conn: sqlite3.Connection, series_uid: str, parent_uid: str) -> None:
    conn.execute(
        "UPDATE series SET derived_from_series_uid=? WHERE series_uid=?",
        (parent_uid, series_uid),
    )


def delete_instance(conn: sqlite3.Connection, sop_uid: str) -> None:
    conn.execute("DELETE FROM instance WHERE sop_uid=?", (sop_uid,))
```

- [ ] **Step 6: Teach the reader about SR objects**

In `backend/app/ingest/reader.py`:

```python
# Comprehensive SR, Enhanced SR, Comprehensive 3D SR. These carry a
# ContentSequence instead of PixelData, so the image required-tag set would
# reject every one of them.
SR_SOP_CLASSES = frozenset({
    "1.2.840.10008.5.1.4.1.1.88.11",
    "1.2.840.10008.5.1.4.1.1.88.22",
    "1.2.840.10008.5.1.4.1.1.88.34",
})
_UIDS = ("SOPInstanceUID", "SeriesInstanceUID", "StudyInstanceUID")
REQUIRED_IMAGE = (*_UIDS, "PixelData")
REQUIRED_SR = (*_UIDS, "ContentSequence")
```

In `read_dicom`, after the `dcmread`, choose the set:

```python
    required = REQUIRED_SR if str(ds.get("SOPClassUID", "")) in SR_SOP_CLASSES else REQUIRED_IMAGE
    for tag in required:
        if tag not in ds:
            raise NotDicomError(f"{path.name}: missing {tag}")
```

Delete the now-unused `REQUIRED` constant unless something else imports it
(grep first). UID syntax validation is unchanged.

- [ ] **Step 7: Make the indexer tolerate missing image tags**

In `backend/app/ingest/indexer.py`, add a helper:

```python
def _int_or_none(ds: Dataset, tag: str) -> int | None:
    v = ds.get(tag)
    return None if v in (None, "") else int(v)
```

In `instance_row_from_dataset`, replace the six image fields. Images keep their
old defaults; non-image objects get `None`:

```python
    is_image = "PixelData" in ds
    return InstanceRow(
        ...
        rows=_int_or_none(ds, "Rows"),
        cols=_int_or_none(ds, "Columns"),
        bits_allocated=_int_or_none(ds, "BitsAllocated"),
        pixel_representation=int(ds.get("PixelRepresentation", 0)) if is_image else None,
        samples_per_pixel=int(ds.get("SamplesPerPixel", 1)) if is_image else None,
        num_frames=int(ds.get("NumberOfFrames", 1) or 1) if is_image else None,
        ...
        sop_class_uid=str(ds.get("SOPClassUID", "")) or None,
        path=str(path),
        transfer_syntax=str(ds.file_meta.TransferSyntaxUID),
    )
```

In `finalize_series`, short-circuit non-image series before the geometry code:

```python
def finalize_series(conn: sqlite3.Connection, series_uid: str) -> SeriesRow:
    rows = repo.list_instances(conn, series_uid)
    if rows and all(r.rows is None for r in rows):
        # A non-image series has no geometry to check and no frame to render
        # as a thumbnail. thumb_sop_uid must stay null: the study browser only
        # requests `rendered` when one is set, and `rendered` cannot produce a
        # PNG from an SR.
        with conn:
            repo.update_series_finalized(
                conn, series_uid,
                instance_count=len(rows), frame_count=0, thumb_sop_uid=None,
                sort_method="instance-number",
                volume=VolumeInfo(False, "structured report, not an image series"),
            )
        series = repo.get_series(conn, series_uid)
        assert series is not None
        return series
    ordered, method = sort_instances(rows)
    ...
```

Also guard `sum(r.num_frames for r in ordered)` against `None` by writing
`sum(r.num_frames or 0 for r in ordered)`. Import `VolumeInfo` from `app.models`.

- [ ] **Step 8: Guard the volume-info size estimate**

In `backend/app/api/volume.py`, replace the `est` block:

```python
    est = None
    if v.dims:
        first = repo.list_instances(conn, series_uid)[0]
        # bits_allocated and samples_per_pixel are None for non-image
        # instances; a series with dims should never be one, but the arithmetic
        # below would raise TypeError rather than return a useful error.
        if first.bits_allocated is not None and first.samples_per_pixel is not None:
            est = (
                v.dims[0] * v.dims[1] * v.dims[2]
                * (first.bits_allocated // 8) * first.samples_per_pixel
            )
```

- [ ] **Step 9: Add the dependency**

In `backend/pyproject.toml`, add `"highdicom>=0.28,<0.29",` to `dependencies`.

- [ ] **Step 10: Run the test to verify it passes**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_non_image_instances.py -v`
Expected: 5 passed.

- [ ] **Step 11: Commit**

```bash
git add backend/app backend/tests/test_non_image_instances.py backend/pyproject.toml
git commit -m "Let the store hold non-image DICOM instances"
```

---

## Task 2: SR build and parse for Length

**Files:**
- Create: `backend/app/sr/__init__.py`, `backend/app/sr/models.py`, `backend/app/sr/build.py`, `backend/app/sr/parse.py`
- Test: `backend/tests/test_sr_build_parse.py`

**Interfaces:**
- Consumes: nothing from Task 1 at import time.
- Produces:
  - `MeasurementValue(name: str, value: float, unit: str)`
  - `Plane(normal: Point3, up: Point3)`
  - `MeasurementItem(id: str, tool: str, points: list[Point3], plane: Plane, values: list[MeasurementValue], label: str | None)`
  - `MeasurementSet(series_uid, frame_of_reference_uid, sr_series_uid, sr_sop_uid, parse_error, measurements)`
  - `build_sr(items, *, frame_of_reference_uid, evidence, sr_series_uid, sr_sop_uid, series_number=99, instance_number=1) -> Dataset`
  - `parse_sr(ds: Dataset) -> list[MeasurementItem]`
  - `class SrParseError(Exception)`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_sr_build_parse.py`:

```python
from __future__ import annotations

import pydicom
import pytest
from pydicom.uid import generate_uid

from app.sr import MeasurementItem, MeasurementValue, Plane, build_sr, parse_sr
from tests.conftest import make_ct_series

COMPREHENSIVE_3D_SR = "1.2.840.10008.5.1.4.1.1.88.34"
FOR_UID = "1.2.826.0.1.3680043.8.498.999"


def length_item() -> MeasurementItem:
    return MeasurementItem(
        id="3f2a9c1e-0000-4000-8000-000000000001",
        tool="Length",
        points=[(-31.2, 14.8, 62.0), (-9.7, 22.4, 62.0)],
        plane=Plane(normal=(0.0, 0.0, 1.0), up=(0.0, -1.0, 0.0)),
        values=[MeasurementValue(name="Length", value=22.8, unit="mm")],
        label=None,
    )


def build_one(item: MeasurementItem) -> pydicom.Dataset:
    evidence = make_ct_series(3)[0]
    return build_sr(
        [item],
        frame_of_reference_uid=FOR_UID,
        evidence=[evidence],
        sr_series_uid=generate_uid(),
        sr_sop_uid=generate_uid(),
    )


def test_length_round_trips_unchanged() -> None:
    item = length_item()
    assert parse_sr(build_one(item)) == [item]


def test_output_is_a_comprehensive_3d_sr() -> None:
    ds = build_one(length_item())
    assert ds.SOPClassUID == COMPREHENSIVE_3D_SR
    assert ds.Modality == "SR"
    assert len(ds.ContentSequence) > 0


def test_template_1500_is_declared() -> None:
    ds = build_one(length_item())
    text = str(ds)
    assert "1500" in text, "the report must declare TID 1500 somewhere"


def test_tracking_uid_and_identifier_are_written() -> None:
    item = length_item()
    text = str(build_one(item))
    assert item.id in text       # Tracking Unique Identifier, DCM 112040
    assert "Length" in text      # Tracking Identifier, DCM 112039, from the tool name


def test_label_is_used_as_the_tracking_identifier_when_present() -> None:
    base = length_item()
    labelled = MeasurementItem(
        id=base.id, tool=base.tool, points=base.points, plane=base.plane,
        values=base.values, label="tumour long axis",
    )
    assert parse_sr(build_one(labelled))[0].label == "tumour long axis"


def test_graphic_data_survives_to_the_millimetre() -> None:
    parsed = parse_sr(build_one(length_item()))[0]
    assert parsed.points == [(-31.2, 14.8, 62.0), (-9.7, 22.4, 62.0)]
    assert parsed.values[0].value == 22.8
    assert parsed.values[0].unit == "mm"
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_sr_build_parse.py -v`
Expected: FAIL at collection, `ModuleNotFoundError: No module named 'app.sr'`.

- [ ] **Step 3: Write the wire models**

Create `backend/app/sr/models.py`:

```python
from __future__ import annotations

from dataclasses import dataclass, field

Point3 = tuple[float, float, float]

# Cornerstone tool names are used verbatim as the wire `tool` value, so the
# frontend never translates between its tool registry and this contract.
TOOL_POINT_COUNTS: dict[str, int] = {
    "Probe": 1,
    "Length": 2,
    "Angle": 3,
    "EllipticalROI": 4,
}


@dataclass(frozen=True)
class MeasurementValue:
    name: str
    value: float
    unit: str


@dataclass(frozen=True)
class Plane:
    normal: Point3
    up: Point3


@dataclass(frozen=True)
class MeasurementItem:
    id: str
    tool: str
    points: list[Point3]
    plane: Plane
    values: list[MeasurementValue]
    label: str | None = None


@dataclass(frozen=True)
class MeasurementSet:
    series_uid: str
    frame_of_reference_uid: str | None
    sr_series_uid: str | None = None
    sr_sop_uid: str | None = None
    parse_error: str | None = None
    measurements: list[MeasurementItem] = field(default_factory=list)
```

- [ ] **Step 4: Write the builder**

Create `backend/app/sr/build.py`:

```python
from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import highdicom as hd
import numpy as np
from pydicom.dataset import Dataset
from pydicom.sr.codedict import codes
from pydicom.sr.coding import Code

from app.sr.models import MeasurementItem, Point3

# Verified against pydicom's code dictionary: the obvious guesses
# (codes.DCM.Length, codes.UCUM.mm, codes.UCUM.degree, codes.DCM.Mean) do not
# exist. Do not "simplify" these back.
VALUE_CODES: dict[str, Code] = {
    "Length": codes.SCT.Length,
    "Angle": codes.SCT.Angle,
    "Area": codes.SCT.Area,
    "Mean": codes.SCT.Mean,
    "StandardDeviation": codes.SCT.StandardDeviation,
}
UNIT_CODES: dict[str, Code] = {
    "mm": codes.UCUM.Millimeter,
    "mm2": codes.UCUM.SquareMillimeter,
    "deg": codes.UCUM.Degree,
    "1": codes.UCUM.NoUnits,
}
# ELLIPSE requires exactly 4 points: both endpoints of the major axis followed
# by both endpoints of the minor axis. Cornerstone's EllipticalROI stores its
# 4 handles in exactly that order, so no reordering is needed.
GRAPHIC_TYPES: dict[str, hd.sr.GraphicTypeValues3D] = {
    "Probe": hd.sr.GraphicTypeValues3D.POINT,
    "Length": hd.sr.GraphicTypeValues3D.POLYLINE,
    "Angle": hd.sr.GraphicTypeValues3D.POLYLINE,
    "EllipticalROI": hd.sr.GraphicTypeValues3D.ELLIPSE,
}

# The view plane has no slot in TID 1500. These concept names carry it as
# additional NUM content items inside the measurement group. A foreign reader
# ignores unrecognised concepts and still reads the measurement correctly;
# without them a reopened two-point length has no way to recover the plane it
# was drawn on.
PLANE_SCHEME = "99DICOMVIEWER"
_AXES = ("X", "Y", "Z")


def _plane_items(item: MeasurementItem) -> list[hd.sr.NumContentItem]:
    out: list[hd.sr.NumContentItem] = []
    for prefix, vec in (("VIEWPLANENORMAL", item.plane.normal), ("VIEWPLANEUP", item.plane.up)):
        for axis, component in zip(_AXES, vec, strict=True):
            out.append(
                hd.sr.NumContentItem(
                    name=Code(f"{prefix}{axis}", PLANE_SCHEME, f"{prefix} {axis}"),
                    value=float(component),
                    unit=codes.UCUM.NoUnits,
                    relationship_type=hd.sr.RelationshipTypeValues.HAS_PROPERTIES,
                )
            )
    return out


def _graphic_data(points: Sequence[Point3]) -> np.ndarray:
    return np.array([[float(x), float(y), float(z)] for x, y, z in points], dtype=float)


def _group(item: MeasurementItem, frame_of_reference_uid: str) -> Any:
    tracking = hd.sr.TrackingIdentifier(uid=item.id, identifier=item.label or item.tool)
    graphic_type = GRAPHIC_TYPES[item.tool]
    data = _graphic_data(item.points)

    if item.tool == "EllipticalROI":
        # A region measurement: the geometry is the group's referenced region,
        # and the numbers hang off it.
        group: Any = hd.sr.PlanarROIMeasurementsAndQualitativeEvaluations(
            tracking_identifier=tracking,
            referenced_region=hd.sr.ImageRegion3D(
                graphic_type=graphic_type,
                graphic_data=data,
                frame_of_reference_uid=frame_of_reference_uid,
            ),
            measurements=[
                hd.sr.Measurement(
                    name=VALUE_CODES[v.name], value=float(v.value), unit=UNIT_CODES[v.unit]
                )
                for v in item.values
            ],
        )
    else:
        # A point, line or angle: the geometry is attached to the measurement
        # itself as referenced coordinates.
        coords = hd.sr.CoordinatesForMeasurement3D(
            graphic_type=graphic_type,
            graphic_data=data,
            frame_of_reference_uid=frame_of_reference_uid,
        )
        group = hd.sr.MeasurementsAndQualitativeEvaluations(
            tracking_identifier=tracking,
            measurements=[
                hd.sr.Measurement(
                    name=VALUE_CODES[v.name],
                    value=float(v.value),
                    unit=UNIT_CODES[v.unit],
                    referenced_coordinates=[coords],
                )
                for v in item.values
            ],
        )
    group[0].ContentSequence.extend(_plane_items(item))
    return group


def build_sr(
    items: Sequence[MeasurementItem],
    *,
    frame_of_reference_uid: str,
    evidence: Sequence[Dataset],
    sr_series_uid: str,
    sr_sop_uid: str,
    series_number: int = 99,
    instance_number: int = 1,
) -> Dataset:
    report = hd.sr.MeasurementReport(
        observation_context=hd.sr.ObservationContext(),
        procedure_reported=codes.DCM.ImagingMeasurementReport,
        imaging_measurements=[_group(i, frame_of_reference_uid) for i in items],
        title=codes.DCM.ImagingMeasurementReport,
    )
    return hd.sr.Comprehensive3DSR(
        evidence=list(evidence),
        content=report[0],
        series_instance_uid=sr_series_uid,
        series_number=series_number,
        sop_instance_uid=sr_sop_uid,
        instance_number=instance_number,
        manufacturer="DICOM 3D Brain Viewer",
        is_complete=True,
        is_final=True,
    )
```

Implementer note: highdicom's templates subclass `ContentSequence`, so a
template instance behaves like a list whose single element is the root
container. `group[0]` and `report[0]` above reflect that. If a `TypeError` says
otherwise, print `type(report)` and adjust; do not guess.

- [ ] **Step 5: Write the parser**

Create `backend/app/sr/parse.py`. It walks `ContentSequence` with pydicom
rather than using `Comprehensive3DSR.from_dataset`, because we only parse
reports we wrote and an explicit walk is predictable and unit-testable.

```python
from __future__ import annotations

from typing import Any

from pydicom.dataset import Dataset

from app.sr.build import PLANE_SCHEME, UNIT_CODES, VALUE_CODES
from app.sr.models import MeasurementItem, MeasurementValue, Plane, Point3

CODE_TO_VALUE_NAME = {c.value: name for name, c in VALUE_CODES.items()}
CODE_TO_UNIT = {c.value: name for name, c in UNIT_CODES.items()}
# POLYLINE is shared by Length and Angle; the point count separates them,
# which is why the wire contract fixes a count per tool.
GRAPHIC_TO_TOOL = {"POINT": "Probe", "ELLIPSE": "EllipticalROI"}
MEASUREMENT_GROUP = "125007"  # DCM, Measurement Group
TRACKING_UID = "112040"
TRACKING_ID = "112039"


class SrParseError(Exception):
    """The dataset is not an SR this application wrote, or is damaged."""


def _children(item: Any) -> list[Dataset]:
    seq = item.get("ContentSequence") if hasattr(item, "get") else None
    return list(seq) if seq else []


def _concept(item: Dataset) -> tuple[str, str]:
    code = item.ConceptNameCodeSequence[0]
    return str(code.CodeValue), str(code.CodingSchemeDesignator)


def _triples(flat: list[float]) -> list[Point3]:
    if len(flat) % 3:
        raise SrParseError(f"graphic data length {len(flat)} is not a multiple of 3")
    # DICOM stores these as FD (64-bit float), so the only loss is whatever the
    # client sent. Rounding to 4 dp keeps round-trip equality from tripping on
    # representation noise; 1e-4 mm is far below any voxel size.
    return [
        (round(flat[i], 4), round(flat[i + 1], 4), round(flat[i + 2], 4))
        for i in range(0, len(flat), 3)
    ]


def _groups(root: Dataset) -> list[Dataset]:
    out: list[Dataset] = []
    stack = _children(root)
    while stack:
        item = stack.pop(0)
        if item.ValueType == "CONTAINER":
            try:
                code, _ = _concept(item)
            except (AttributeError, IndexError):
                code = ""
            if code == MEASUREMENT_GROUP:
                out.append(item)
                continue
        stack.extend(_children(item))
    return out


def _descendants(group: Dataset) -> list[Dataset]:
    out: list[Dataset] = []
    stack = _children(group)
    while stack:
        item = stack.pop(0)
        out.append(item)
        stack.extend(_children(item))
    return out


def _plane(items: list[Dataset]) -> Plane:
    parts: dict[str, float] = {}
    for item in items:
        if item.ValueType != "NUM":
            continue
        try:
            code, scheme = _concept(item)
        except (AttributeError, IndexError):
            continue
        if scheme == PLANE_SCHEME:
            parts[code] = float(item.MeasuredValueSequence[0].NumericValue)
    try:
        normal = tuple(round(parts[f"VIEWPLANENORMAL{a}"], 6) for a in "XYZ")
        up = tuple(round(parts[f"VIEWPLANEUP{a}"], 6) for a in "XYZ")
    except KeyError as e:
        raise SrParseError(f"measurement group is missing view plane component {e}") from e
    return Plane(normal=normal, up=up)  # type: ignore[arg-type]


def _tracking(items: list[Dataset]) -> tuple[str, str | None]:
    uid = identifier = None
    for item in items:
        try:
            code, _ = _concept(item)
        except (AttributeError, IndexError):
            continue
        if code == TRACKING_UID:
            uid = str(item.UID)
        elif code == TRACKING_ID:
            identifier = str(item.TextValue)
    if uid is None:
        raise SrParseError("measurement group has no tracking unique identifier")
    return uid, identifier


def _scoord(items: list[Dataset]) -> tuple[str, list[Point3]]:
    for item in items:
        if item.ValueType == "SCOORD3D":
            return str(item.GraphicType), _triples([float(v) for v in item.GraphicData])
    raise SrParseError("measurement group has no SCOORD3D")


def _values(items: list[Dataset]) -> list[MeasurementValue]:
    out: list[MeasurementValue] = []
    for item in items:
        if item.ValueType != "NUM":
            continue
        try:
            code, scheme = _concept(item)
        except (AttributeError, IndexError):
            continue
        if scheme == PLANE_SCHEME or code not in CODE_TO_VALUE_NAME:
            continue
        mv = item.MeasuredValueSequence[0]
        unit_code = str(mv.MeasurementUnitsCodeSequence[0].CodeValue)
        out.append(
            MeasurementValue(
                name=CODE_TO_VALUE_NAME[code],
                value=round(float(mv.NumericValue), 4),
                unit=CODE_TO_UNIT.get(unit_code, unit_code),
            )
        )
    return out


def parse_sr(ds: Dataset) -> list[MeasurementItem]:
    groups = _groups(ds)
    if not groups:
        raise SrParseError("no measurement groups found")
    items: list[MeasurementItem] = []
    for group in groups:
        flat = _descendants(group)
        uid, identifier = _tracking(flat)
        graphic_type, points = _scoord(flat)
        tool = GRAPHIC_TO_TOOL.get(graphic_type) or ("Angle" if len(points) == 3 else "Length")
        items.append(
            MeasurementItem(
                id=uid,
                tool=tool,
                points=points,
                plane=_plane(flat),
                values=_values(flat),
                label=None if identifier == tool else identifier,
            )
        )
    return items
```

- [ ] **Step 6: Write the package exports**

Create `backend/app/sr/__init__.py`:

```python
from app.sr.build import build_sr
from app.sr.models import (
    TOOL_POINT_COUNTS,
    MeasurementItem,
    MeasurementSet,
    MeasurementValue,
    Plane,
    Point3,
)
from app.sr.parse import SrParseError, parse_sr

__all__ = [
    "TOOL_POINT_COUNTS",
    "MeasurementItem",
    "MeasurementSet",
    "MeasurementValue",
    "Plane",
    "Point3",
    "SrParseError",
    "build_sr",
    "parse_sr",
]
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_sr_build_parse.py -v`
Expected: 6 passed.

If `test_length_round_trips_unchanged` fails on float equality, check that both
`_triples` and the builder agree on rounding before loosening the assertion.
Do not replace `==` with `pytest.approx` to make it go away; the contract is
that a round trip is exact at 4 decimal places.

- [ ] **Step 8: Commit**

```bash
git add backend/app/sr backend/tests/test_sr_build_parse.py
git commit -m "Build and parse a Comprehensive 3D SR for length measurements"
```

---

## Task 3: The remaining three tools

**Files:**
- Modify: `backend/app/sr/build.py`, `backend/app/sr/parse.py` (only if the tests reveal a gap)
- Test: `backend/tests/test_sr_build_parse.py`

**Interfaces:**
- Consumes: everything Task 2 produced.
- Produces: no new names. `build_sr` and `parse_sr` now handle `Angle`, `Probe` and `EllipticalROI`.

- [ ] **Step 1: Write the failing tests**

Append to `backend/tests/test_sr_build_parse.py`:

```python
def angle_item() -> MeasurementItem:
    return MeasurementItem(
        id="3f2a9c1e-0000-4000-8000-000000000002",
        tool="Angle",
        points=[(0.0, 0.0, 10.0), (10.0, 0.0, 10.0), (10.0, 10.0, 10.0)],
        plane=Plane(normal=(0.0, 0.0, 1.0), up=(0.0, -1.0, 0.0)),
        values=[MeasurementValue(name="Angle", value=90.0, unit="deg")],
        label=None,
    )


def probe_item() -> MeasurementItem:
    return MeasurementItem(
        id="3f2a9c1e-0000-4000-8000-000000000003",
        tool="Probe",
        points=[(4.0, 5.0, 6.0)],
        plane=Plane(normal=(1.0, 0.0, 0.0), up=(0.0, 0.0, 1.0)),
        values=[MeasurementValue(name="Mean", value=317.0, unit="1")],
        label=None,
    )


def ellipse_item() -> MeasurementItem:
    return MeasurementItem(
        id="3f2a9c1e-0000-4000-8000-000000000004",
        tool="EllipticalROI",
        points=[(0.0, 5.0, 2.0), (10.0, 5.0, 2.0), (5.0, 0.0, 2.0), (5.0, 10.0, 2.0)],
        plane=Plane(normal=(0.0, 0.0, 1.0), up=(0.0, -1.0, 0.0)),
        values=[
            MeasurementValue(name="Area", value=78.54, unit="mm2"),
            MeasurementValue(name="Mean", value=112.5, unit="1"),
            MeasurementValue(name="StandardDeviation", value=18.2, unit="1"),
        ],
        label=None,
    )


@pytest.mark.parametrize(
    "factory", [length_item, angle_item, probe_item, ellipse_item], ids=lambda f: f.__name__
)
def test_every_tool_round_trips_unchanged(factory) -> None:
    item = factory()
    assert parse_sr(build_one(item)) == [item]


def test_graphic_types_match_the_contract() -> None:
    expected = {
        "Probe": "POINT",
        "Length": "POLYLINE",
        "Angle": "POLYLINE",
        "EllipticalROI": "ELLIPSE",
    }
    for factory in (length_item, angle_item, probe_item, ellipse_item):
        item = factory()
        assert expected[item.tool] in str(build_one(item)), item.tool


def test_several_measurements_in_one_report_keep_their_identities() -> None:
    items = [length_item(), angle_item(), probe_item(), ellipse_item()]
    evidence = make_ct_series(3)[0]
    ds = build_sr(
        items,
        frame_of_reference_uid=FOR_UID,
        evidence=[evidence],
        sr_series_uid=generate_uid(),
        sr_sop_uid=generate_uid(),
    )
    parsed = parse_sr(ds)
    assert {p.id for p in parsed} == {i.id for i in items}
    assert sorted(p.tool for p in parsed) == sorted(i.tool for i in items)
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_sr_build_parse.py -v`
Expected: the parametrised `probe_item` and `ellipse_item` cases fail, plus
`test_several_measurements_in_one_report_keep_their_identities`. `angle_item`
may already pass, which is fine and needs no change.

- [ ] **Step 3: Fix whatever the failures name**

Likely causes, in order of probability:

1. **`ELLIPSE` graphic data shape.** highdicom validates that an ELLIPSE
   carries exactly 4 points. `_graphic_data` already produces `(4, 3)`. If it
   complains about ordering, the fix is in the comment above `GRAPHIC_TYPES`,
   not in reordering Cornerstone's handles.
2. **`PlanarROIMeasurementsAndQualitativeEvaluations` nests its SCOORD3D under
   the referenced region rather than under a measurement.** `_descendants`
   already flattens the whole group, so `_scoord` finds it either way. If it
   does not, print the group with `print(group)` and widen `_descendants`.
3. **A single-point POINT graphic.** If `CoordinatesForMeasurement3D` rejects a
   `(1, 3)` array, pass the array through `np.atleast_2d`.

Make the smallest change that makes the test pass, and leave a one-line comment
saying what the library actually required.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_sr_build_parse.py -v`
Expected: 12 passed.

- [ ] **Step 5: Commit**

```bash
git add backend/app/sr backend/tests/test_sr_build_parse.py
git commit -m "Support angle, probe and elliptical ROI in the SR round trip"
```

---

## Task 4: Validation and the measurements API

**Files:**
- Create: `backend/app/sr/validate.py`, `backend/app/api/measurements.py`
- Modify: `backend/app/main.py`, `backend/app/sr/__init__.py`
- Test: `backend/tests/test_sr_validate.py`, `backend/tests/test_measurements_api.py`

**Interfaces:**
- Consumes: Task 1's `repo.find_derived_series`, `repo.set_derived_from`, `repo.delete_instance`; Task 2 and 3's `build_sr`, `parse_sr`, wire models.
- Produces: `validate_set(items, *, frame_of_reference_uid) -> None`, `class SrValidationError(Exception)`; routes `GET`/`PUT /api/series/{series_uid}/measurements`.

- [ ] **Step 1: Write the failing validation test**

Create `backend/tests/test_sr_validate.py`:

```python
from __future__ import annotations

import pytest

from app.sr import MeasurementItem, MeasurementValue, Plane
from app.sr.validate import SrValidationError, validate_set

PLANE = Plane(normal=(0.0, 0.0, 1.0), up=(0.0, -1.0, 0.0))


def item(**over) -> MeasurementItem:
    base = dict(
        id="a",
        tool="Length",
        points=[(0.0, 0.0, 0.0), (3.0, 4.0, 0.0)],
        plane=PLANE,
        values=[MeasurementValue("Length", 5.0, "mm")],
        label=None,
    )
    return MeasurementItem(**{**base, **over})


def test_a_consistent_length_is_accepted() -> None:
    validate_set([item()], frame_of_reference_uid="1.2")


def test_wrong_point_count_is_rejected() -> None:
    with pytest.raises(SrValidationError, match="expects 2 points"):
        validate_set([item(points=[(0.0, 0.0, 0.0)])], frame_of_reference_uid="1.2")


def test_unknown_tool_is_rejected() -> None:
    with pytest.raises(SrValidationError, match="unknown tool"):
        validate_set([item(tool="Sphere")], frame_of_reference_uid="1.2")


def test_non_finite_coordinate_is_rejected() -> None:
    with pytest.raises(SrValidationError, match="not finite"):
        validate_set(
            [item(points=[(0.0, 0.0, 0.0), (float("nan"), 0.0, 0.0)])],
            frame_of_reference_uid="1.2",
        )


def test_length_disagreeing_with_its_own_points_is_rejected() -> None:
    with pytest.raises(SrValidationError, match="disagrees"):
        validate_set(
            [item(values=[MeasurementValue("Length", 99.0, "mm")])],
            frame_of_reference_uid="1.2",
        )


def test_angle_disagreeing_with_its_own_points_is_rejected() -> None:
    bad = item(
        tool="Angle",
        points=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 1.0, 0.0)],
        values=[MeasurementValue("Angle", 45.0, "deg")],
    )
    with pytest.raises(SrValidationError, match="disagrees"):
        validate_set([bad], frame_of_reference_uid="1.2")


def test_a_missing_frame_of_reference_is_rejected() -> None:
    with pytest.raises(SrValidationError, match="frame of reference"):
        validate_set([item()], frame_of_reference_uid="")


def test_roi_statistics_are_taken_on_trust() -> None:
    roi = item(
        tool="EllipticalROI",
        points=[(0.0, 5.0, 0.0), (10.0, 5.0, 0.0), (5.0, 0.0, 0.0), (5.0, 10.0, 0.0)],
        values=[MeasurementValue("Area", 1.0, "mm2")],  # nonsense, accepted
    )
    validate_set([roi], frame_of_reference_uid="1.2")
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_sr_validate.py -v`
Expected: FAIL, `ModuleNotFoundError: No module named 'app.sr.validate'`.

- [ ] **Step 3: Write the validator**

Create `backend/app/sr/validate.py`:

```python
from __future__ import annotations

import math
from collections.abc import Sequence

from app.sr.models import TOOL_POINT_COUNTS, MeasurementItem, Point3

# Millimetres and degrees. Comfortably tighter than any real drag, comfortably
# looser than float noise between the browser's computation and this one.
TOLERANCE = 1e-3


class SrValidationError(Exception):
    """A measurement set the client sent cannot be stored as written."""


def _sub(a: Point3, b: Point3) -> Point3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _norm(v: Point3) -> float:
    return math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)


def _dot(a: Point3, b: Point3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _expected_value(item: MeasurementItem) -> tuple[str, float] | None:
    """The one value this tool's own coordinates determine, if any."""
    if item.tool == "Length":
        return "Length", _norm(_sub(item.points[1], item.points[0]))
    if item.tool == "Angle":
        a, b = _sub(item.points[0], item.points[1]), _sub(item.points[2], item.points[1])
        na, nb = _norm(a), _norm(b)
        if na == 0 or nb == 0:
            raise SrValidationError(f"{item.id}: angle has a zero-length arm")
        cos = max(-1.0, min(1.0, _dot(a, b) / (na * nb)))
        return "Angle", math.degrees(math.acos(cos))
    # Probe samples a voxel and ROI statistics need pixel access; neither is
    # derivable from coordinates alone, so both are recorded on trust.
    return None


def validate_set(items: Sequence[MeasurementItem], *, frame_of_reference_uid: str) -> None:
    if not frame_of_reference_uid:
        raise SrValidationError("series has no frame of reference, so it cannot be measured")
    for item in items:
        expected_count = TOOL_POINT_COUNTS.get(item.tool)
        if expected_count is None:
            raise SrValidationError(f"{item.id}: unknown tool {item.tool!r}")
        if len(item.points) != expected_count:
            raise SrValidationError(
                f"{item.id}: {item.tool} expects {expected_count} points, "
                f"got {len(item.points)}"
            )
        for point in item.points:
            if not all(math.isfinite(c) for c in point):
                raise SrValidationError(f"{item.id}: coordinate is not finite")
        for vector in (item.plane.normal, item.plane.up):
            if not all(math.isfinite(c) for c in vector):
                raise SrValidationError(f"{item.id}: view plane is not finite")
        check = _expected_value(item)
        if check is None:
            continue
        name, computed = check
        stated = next((v.value for v in item.values if v.name == name), None)
        if stated is None:
            raise SrValidationError(f"{item.id}: {item.tool} has no {name} value")
        if abs(stated - computed) > TOLERANCE:
            raise SrValidationError(
                f"{item.id}: stated {name} {stated} disagrees with its own "
                f"coordinates ({computed:.4f})"
            )
```

Add `SrValidationError` and `validate_set` to the imports and `__all__` in
`app/sr/__init__.py`.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_sr_validate.py -v`
Expected: 8 passed.

- [ ] **Step 5: Write the failing API test**

Create `backend/tests/test_measurements_api.py`:

```python
from __future__ import annotations

from pathlib import Path

import pydicom
from fastapi.testclient import TestClient

from app import repo
from app.ingest.indexer import ingest_files
from tests.conftest import make_ct_series

FOR_UID = "1.2.826.0.1.3680043.8.498.777"


def seed(client: TestClient, tmp_path: Path, *, frame_of_reference: bool = True) -> str:
    """Ingest a 4-slice CT series, with or without a frame of reference."""
    datasets = make_ct_series(4)
    paths = []
    for i, ds in enumerate(datasets):
        if frame_of_reference:
            ds.FrameOfReferenceUID = FOR_UID
        elif "FrameOfReferenceUID" in ds:
            del ds.FrameOfReferenceUID
        p = tmp_path / f"{'f' if frame_of_reference else 'n'}{i}.dcm"
        pydicom.dcmwrite(p, ds, enforce_file_format=True)
        paths.append(p)
    ingest_files(client.app.state.db, paths, client.app.state.settings.store_dir)
    return str(datasets[0].SeriesInstanceUID)


def length_payload(value: float = 5.0) -> dict:
    return {
        "id": "11111111-1111-4111-8111-111111111111",
        "tool": "Length",
        "points": [[0.0, 0.0, 0.0], [3.0, 4.0, 0.0]],
        "plane": {"normal": [0.0, 0.0, 1.0], "up": [0.0, -1.0, 0.0]},
        "values": [{"name": "Length", "value": value, "unit": "mm"}],
        "label": None,
    }


def study_uid_of(client: TestClient) -> str:
    return str(client.get("/dicomweb/studies").json()[0]["0020000D"]["Value"][0])


def test_get_returns_an_empty_set_when_there_is_no_report(client, tmp_path) -> None:
    series_uid = seed(client, tmp_path)
    body = client.get(f"/api/series/{series_uid}/measurements").json()
    assert body["measurements"] == []
    assert body["srSopUid"] is None
    assert body["parseError"] is None
    assert body["frameOfReferenceUid"] == FOR_UID


def test_put_then_get_round_trips_through_the_store(client, tmp_path) -> None:
    series_uid = seed(client, tmp_path)
    put = client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": None, "measurements": [length_payload()]},
    )
    assert put.status_code == 200, put.text
    sop = put.json()["srSopUid"]
    assert sop

    got = client.get(f"/api/series/{series_uid}/measurements").json()
    assert got["srSopUid"] == sop
    assert len(got["measurements"]) == 1
    assert got["measurements"][0]["values"][0]["value"] == 5.0
    assert got["measurements"][0]["tool"] == "Length"


def test_the_report_is_retrievable_through_wado(client, tmp_path) -> None:
    series_uid = seed(client, tmp_path)
    put = client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": None, "measurements": [length_payload()]},
    ).json()
    r = client.get(
        f"/dicomweb/studies/{study_uid_of(client)}/series/{put['srSeriesUid']}"
        f"/instances/{put['srSopUid']}"
    )
    assert r.status_code == 200


def test_saving_twice_replaces_rather_than_accumulates(client, tmp_path) -> None:
    series_uid = seed(client, tmp_path)
    first = client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": None, "measurements": [length_payload()]},
    ).json()
    second = client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": first["srSopUid"], "measurements": [length_payload()]},
    ).json()

    assert second["srSopUid"] != first["srSopUid"]
    assert second["srSeriesUid"] == first["srSeriesUid"]
    instances = client.get(
        f"/dicomweb/studies/{study_uid_of(client)}/series/{second['srSeriesUid']}/instances"
    ).json()
    assert len(instances) == 1


def test_a_stale_sop_uid_is_rejected(client, tmp_path) -> None:
    series_uid = seed(client, tmp_path)
    client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": None, "measurements": [length_payload()]},
    )
    r = client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": "1.2.3.stale", "measurements": [length_payload()]},
    )
    assert r.status_code == 409


def test_an_inconsistent_length_is_rejected(client, tmp_path) -> None:
    series_uid = seed(client, tmp_path)
    r = client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": None, "measurements": [length_payload(value=99.0)]},
    )
    assert r.status_code == 422
    assert "disagrees" in r.json()["detail"]


def test_a_corrupt_report_yields_parse_error_not_a_500(client, tmp_path) -> None:
    series_uid = seed(client, tmp_path)
    put = client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": None, "measurements": [length_payload()]},
    ).json()

    inst = repo.get_instance(client.app.state.db, put["srSopUid"])
    assert inst is not None
    ds = pydicom.dcmread(inst.path)
    del ds.ContentSequence  # still a valid file, no longer a report we can read
    pydicom.dcmwrite(inst.path, ds, enforce_file_format=True)

    body = client.get(f"/api/series/{series_uid}/measurements").json()
    assert body["measurements"] == []
    assert body["parseError"]


def test_a_series_without_a_frame_of_reference_refuses_measurement(client, tmp_path) -> None:
    series_uid = seed(client, tmp_path, frame_of_reference=False)

    body = client.get(f"/api/series/{series_uid}/measurements").json()
    assert body["frameOfReferenceUid"] is None

    r = client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": None, "measurements": [length_payload()]},
    )
    assert r.status_code == 422
```

- [ ] **Step 6: Run to verify it fails**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_measurements_api.py -v`
Expected: FAIL, all with 404, since the routes do not exist.

- [ ] **Step 7: Write the routes**

Create `backend/app/api/measurements.py`:

```python
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

import pydicom
from fastapi import APIRouter, Body, Depends, HTTPException
from pydicom.dataset import Dataset
from pydicom.uid import generate_uid

from app import repo
from app.config import Settings
from app.dicomweb.deps import get_db, get_settings_dep
from app.ingest.indexer import finalize_series, index_instance
from app.ingest.store import file_instance
from app.models import InstanceRow, SeriesRow
from app.sr import MeasurementItem, MeasurementValue, Plane, SrParseError, build_sr, parse_sr
from app.sr.validate import SrValidationError, validate_set

router = APIRouter(prefix="/api", tags=["measurements"])
SR_MODALITY = "SR"


def _frame_of_reference(conn: sqlite3.Connection, series_uid: str) -> str | None:
    for inst in repo.list_instances(conn, series_uid):
        ds = pydicom.dcmread(inst.path, stop_before_pixels=True)
        for_uid = str(ds.get("FrameOfReferenceUID", "")) or None
        if for_uid:
            return for_uid
    return None


def _current_sr(
    conn: sqlite3.Connection, series_uid: str
) -> tuple[SeriesRow | None, InstanceRow | None]:
    series = repo.find_derived_series(conn, series_uid, SR_MODALITY)
    if series is None:
        return None, None
    instances = repo.list_instances(conn, series.series_uid)
    if not instances:
        return series, None
    # Newest wins. A crash between "write the new report" and "delete the old"
    # leaves two, and the newer one is the truth.
    newest = max(instances, key=lambda i: (i.instance_number or 0, i.sop_uid))
    return series, newest


def _item_to_json(m: MeasurementItem) -> dict[str, Any]:
    return {
        "id": m.id,
        "tool": m.tool,
        "points": [list(p) for p in m.points],
        "plane": {"normal": list(m.plane.normal), "up": list(m.plane.up)},
        "values": [{"name": v.name, "value": v.value, "unit": v.unit} for v in m.values],
        "label": m.label,
    }


def _item_from_json(raw: dict[str, Any]) -> MeasurementItem:
    try:
        return MeasurementItem(
            id=str(raw["id"]),
            tool=str(raw["tool"]),
            points=[(float(p[0]), float(p[1]), float(p[2])) for p in raw["points"]],
            plane=Plane(
                normal=tuple(float(c) for c in raw["plane"]["normal"]),  # type: ignore[arg-type]
                up=tuple(float(c) for c in raw["plane"]["up"]),  # type: ignore[arg-type]
            ),
            values=[
                MeasurementValue(str(v["name"]), float(v["value"]), str(v["unit"]))
                for v in raw["values"]
            ],
            label=raw.get("label") or None,
        )
    except (KeyError, TypeError, ValueError, IndexError) as e:
        raise HTTPException(422, f"malformed measurement: {e}") from e


def _envelope(
    series_uid: str,
    for_uid: str | None,
    sr_series_uid: str | None,
    sr_sop_uid: str | None,
    items: list[MeasurementItem],
    parse_error: str | None,
) -> dict[str, Any]:
    return {
        "seriesUid": series_uid,
        "frameOfReferenceUid": for_uid,
        "srSeriesUid": sr_series_uid,
        "srSopUid": sr_sop_uid,
        "parseError": parse_error,
        "measurements": [_item_to_json(m) for m in items],
    }


@router.get("/series/{series_uid}/measurements")
def get_measurements(
    series_uid: str, conn: sqlite3.Connection = Depends(get_db)
) -> dict[str, Any]:
    if repo.get_series(conn, series_uid) is None:
        raise HTTPException(404, f"series {series_uid} not found")
    for_uid = _frame_of_reference(conn, series_uid)
    sr_series, newest = _current_sr(conn, series_uid)
    if sr_series is None or newest is None:
        return _envelope(series_uid, for_uid, None, None, [], None)
    try:
        items = parse_sr(pydicom.dcmread(newest.path))
    except (SrParseError, AttributeError, KeyError, ValueError, OSError) as e:
        # A report we cannot read must never stop the series opening.
        return _envelope(
            series_uid, for_uid, sr_series.series_uid, newest.sop_uid, [],
            f"{type(e).__name__}: {e}",
        )
    return _envelope(series_uid, for_uid, sr_series.series_uid, newest.sop_uid, items, None)


@router.put("/series/{series_uid}/measurements")
def put_measurements(
    series_uid: str,
    payload: dict[str, Any] = Body(...),
    conn: sqlite3.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> dict[str, Any]:
    if repo.get_series(conn, series_uid) is None:
        raise HTTPException(404, f"series {series_uid} not found")
    instances = repo.list_instances(conn, series_uid)
    if not instances:
        raise HTTPException(404, f"series {series_uid} has no instances")
    for_uid = _frame_of_reference(conn, series_uid)

    items = [_item_from_json(raw) for raw in payload.get("measurements", [])]
    try:
        validate_set(items, frame_of_reference_uid=for_uid or "")
    except SrValidationError as e:
        raise HTTPException(422, str(e)) from e

    sr_series, previous = _current_sr(conn, series_uid)
    sent = payload.get("srSopUid")
    current = previous.sop_uid if previous else None
    if sent != current:
        raise HTTPException(
            409, f"report changed since it was loaded (expected {current!r}, got {sent!r})"
        )

    sr_series_uid = sr_series.series_uid if sr_series else generate_uid()
    sop_uid = generate_uid()
    evidence: list[Dataset] = [pydicom.dcmread(instances[0].path, stop_before_pixels=True)]
    ds = build_sr(
        items,
        frame_of_reference_uid=for_uid or "",
        evidence=evidence,
        sr_series_uid=sr_series_uid,
        sr_sop_uid=sop_uid,
        instance_number=(previous.instance_number or 0) + 1 if previous else 1,
    )

    # Write the new report, index it, and only then drop the old one. The
    # reverse order can lose the only copy; this order can at worst leave an
    # extra instance, which `_current_sr` ignores because the newest wins.
    dest = file_instance(ds, settings.store_dir)
    index_instance(conn, ds, dest)
    with conn:
        repo.set_derived_from(conn, sr_series_uid, series_uid)
    if previous is not None:
        Path(previous.path).unlink(missing_ok=True)
        with conn:
            repo.delete_instance(conn, previous.sop_uid)
    finalize_series(conn, sr_series_uid)

    return _envelope(series_uid, for_uid, sr_series_uid, sop_uid, items, None)
```

- [ ] **Step 8: Register the router**

In `backend/app/main.py`, add `measurements` to the `app.api` import and to the
router tuple:

```python
from app.api import health, measurements, upload, volume
...
    for r in (health.router, volume.router, upload.router, measurements.router,
              qido.router, wado.router):
```

- [ ] **Step 9: Run to verify it passes**

Run: `cd backend && .venv/Scripts/python.exe -m pytest tests/test_measurements_api.py -v`
Expected: 8 passed.

- [ ] **Step 10: Commit**

```bash
git add backend/app backend/tests/test_sr_validate.py backend/tests/test_measurements_api.py
git commit -m "Serve measurements as a stored Structured Report"
```

---

## Task 5: Frontend transport and the annotation adapter

**Files:**
- Create: `frontend/src/api/measurements.ts`, `frontend/src/cornerstone/annotations.ts`, `frontend/src/cornerstone/annotations.test.ts`
- Modify: `frontend/src/api/types.ts`, `frontend/src/test/msw.ts`

**Interfaces:**
- Consumes: Task 4's endpoints.
- Produces:
  - types `MeasurementValue`, `Plane`, `MeasurementItem`, `MeasurementSet`, `ToolName = 'Length' | 'Angle' | 'Probe' | 'EllipticalROI'`
  - `getMeasurements(seriesUid): Promise<MeasurementSet>`, `putMeasurements(seriesUid, srSopUid, measurements): Promise<MeasurementSet>`
  - `toWire(a): MeasurementItem | null`, `fromWire(item, frameOfReferenceUID?): WireAnnotation`, `loadAnnotations(items, frameOfReferenceUID): void`, `readAnnotations(frameOfReferenceUID): MeasurementItem[]`, `clearAnnotations(): void`

- [ ] **Step 1: Add the wire types**

Append to `frontend/src/api/types.ts`:

```ts
export type ToolName = 'Length' | 'Angle' | 'Probe' | 'EllipticalROI';
export interface MeasurementValue {
  name: string;
  value: number;
  unit: string;
}
export interface Plane {
  normal: [number, number, number];
  up: [number, number, number];
}
export interface MeasurementItem {
  id: string;
  tool: ToolName;
  points: [number, number, number][];
  plane: Plane;
  values: MeasurementValue[];
  label: string | null;
}
export interface MeasurementSet {
  seriesUid: string;
  frameOfReferenceUid: string | null;
  srSeriesUid: string | null;
  srSopUid: string | null;
  parseError: string | null;
  measurements: MeasurementItem[];
}
```

- [ ] **Step 2: Write the transport**

Create `frontend/src/api/measurements.ts`:

```ts
import { apiFetch } from './client';
import type { MeasurementItem, MeasurementSet } from './types';

export const getMeasurements = (seriesUid: string): Promise<MeasurementSet> =>
  apiFetch<MeasurementSet>(`/api/series/${seriesUid}/measurements`);

export const putMeasurements = (
  seriesUid: string,
  srSopUid: string | null,
  measurements: MeasurementItem[],
): Promise<MeasurementSet> =>
  apiFetch<MeasurementSet>(`/api/series/${seriesUid}/measurements`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ srSopUid, measurements }),
  });
```

- [ ] **Step 3: Write the failing adapter test**

Create `frontend/src/cornerstone/annotations.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { fromWire, toWire } from './annotations';
import type { MeasurementItem } from '../api/types';

const item: MeasurementItem = {
  id: '11111111-1111-4111-8111-111111111111',
  tool: 'Length',
  points: [
    [-31.2, 14.8, 62],
    [-9.7, 22.4, 62],
  ],
  plane: { normal: [0, 0, 1], up: [0, -1, 0] },
  values: [{ name: 'Length', value: 22.8, unit: 'mm' }],
  label: null,
};

describe('annotation conversion', () => {
  test('a wire item becomes a Cornerstone annotation', () => {
    const a = fromWire(item, '1.2.9');
    expect(a.annotationUID).toBe(item.id);
    expect(a.metadata.toolName).toBe('Length');
    expect(a.metadata.FrameOfReferenceUID).toBe('1.2.9');
    expect(a.metadata.viewPlaneNormal).toEqual([0, 0, 1]);
    expect(a.metadata.viewUp).toEqual([0, -1, 0]);
    expect(a.data.handles.points).toEqual(item.points);
  });

  test('round trip through the Cornerstone shape is lossless', () => {
    expect(toWire(fromWire(item))).toEqual(item);
  });

  test('an annotation from an unsupported tool is dropped rather than sent', () => {
    const a = fromWire(item);
    a.metadata.toolName = 'CobbAngle';
    expect(toWire(a)).toBeNull();
  });

  test('a label survives the round trip', () => {
    const labelled = { ...item, label: 'tumour long axis' };
    expect(toWire(fromWire(labelled))?.label).toBe('tumour long axis');
  });

  test('all three elliptical ROI statistics survive the round trip', () => {
    const roi: MeasurementItem = {
      ...item,
      tool: 'EllipticalROI',
      points: [
        [0, 5, 2],
        [10, 5, 2],
        [5, 0, 2],
        [5, 10, 2],
      ],
      values: [
        { name: 'Area', value: 78.54, unit: 'mm2' },
        { name: 'Mean', value: 112.5, unit: '1' },
        { name: 'StandardDeviation', value: 18.2, unit: '1' },
      ],
    };
    const back = toWire(fromWire(roi));
    expect(back?.values.map((v) => v.name).sort()).toEqual([
      'Area',
      'Mean',
      'StandardDeviation',
    ]);
  });
});
```

- [ ] **Step 4: Run to verify it fails**

Run: `cd frontend && npx vitest run src/cornerstone/annotations.test.ts`
Expected: FAIL, cannot resolve `./annotations`.

- [ ] **Step 5: Write the adapter**

Create `frontend/src/cornerstone/annotations.ts`. This is the only module that
may touch Cornerstone's annotation state manager.

```ts
import { annotation } from '@cornerstonejs/tools';
import type { MeasurementItem, MeasurementValue, ToolName } from '../api/types';

const TOOLS: ToolName[] = ['Length', 'Angle', 'Probe', 'EllipticalROI'];

// Cornerstone stores per-tool results under `cachedStats`, keyed by a string
// that embeds the volume id, with a different shape per tool. These maps are
// the whole translation: wire value name on the left, cachedStats key on the
// right.
const STAT_KEYS: Record<ToolName, Record<string, string>> = {
  Length: { Length: 'length' },
  Angle: { Angle: 'angle' },
  Probe: { Mean: 'value' },
  EllipticalROI: { Area: 'area', Mean: 'mean', StandardDeviation: 'stdDev' },
};
const UNITS: Record<string, string> = {
  Length: 'mm',
  Angle: 'deg',
  Area: 'mm2',
  Mean: '1',
  StandardDeviation: '1',
};

export interface WireAnnotation {
  annotationUID: string;
  highlighted: boolean;
  invalidated: boolean;
  isLocked: boolean;
  isVisible: boolean;
  metadata: {
    toolName: string;
    FrameOfReferenceUID: string;
    viewPlaneNormal: [number, number, number];
    viewUp: [number, number, number];
  };
  data: {
    label?: string;
    handles: { points: [number, number, number][]; activeHandleIndex: number | null };
    cachedStats: Record<string, Record<string, number>>;
  };
}

const firstStats = (a: WireAnnotation): Record<string, number> =>
  Object.values(a.data.cachedStats ?? {})[0] ?? {};

export function fromWire(item: MeasurementItem, frameOfReferenceUID = ''): WireAnnotation {
  const keys = STAT_KEYS[item.tool];
  const stats: Record<string, number> = {};
  for (const v of item.values) {
    const key = keys[v.name];
    if (key) stats[key] = v.value;
  }
  return {
    annotationUID: item.id,
    highlighted: false,
    invalidated: false,
    isLocked: false,
    isVisible: true,
    metadata: {
      toolName: item.tool,
      FrameOfReferenceUID: frameOfReferenceUID,
      viewPlaneNormal: item.plane.normal,
      viewUp: item.plane.up,
    },
    data: {
      ...(item.label ? { label: item.label } : {}),
      handles: { points: item.points, activeHandleIndex: null },
      // The key is arbitrary on load; Cornerstone recomputes it against the
      // real volume id on the first render.
      cachedStats: { restored: stats },
    },
  };
}

export function toWire(a: WireAnnotation): MeasurementItem | null {
  const tool = a.metadata.toolName as ToolName;
  if (!TOOLS.includes(tool)) return null;
  const stats = firstStats(a);
  const values: MeasurementValue[] = Object.entries(STAT_KEYS[tool])
    .filter(([, key]) => typeof stats[key] === 'number' && Number.isFinite(stats[key]))
    .map(([name, key]) => ({ name, value: stats[key]!, unit: UNITS[name]! }));
  return {
    id: a.annotationUID,
    tool,
    points: a.data.handles.points,
    plane: { normal: a.metadata.viewPlaneNormal, up: a.metadata.viewUp },
    values,
    label: a.data.label ?? null,
  };
}

export function loadAnnotations(items: MeasurementItem[], frameOfReferenceUID: string): void {
  for (const item of items)
    annotation.state.addAnnotation(
      fromWire(item, frameOfReferenceUID) as never,
      frameOfReferenceUID,
    );
}

export function readAnnotations(frameOfReferenceUID: string): MeasurementItem[] {
  const out: MeasurementItem[] = [];
  for (const tool of TOOLS) {
    const found = annotation.state.getAnnotations(tool, frameOfReferenceUID) ?? [];
    for (const a of found) {
      const item = toWire(a as unknown as WireAnnotation);
      if (item) out.push(item);
    }
  }
  return out;
}

export function clearAnnotations(): void {
  annotation.state.removeAllAnnotations();
}
```

- [ ] **Step 6: Add MSW handlers**

In `frontend/src/test/msw.ts`, add to `handlers`:

```ts
  http.get(`${API}/api/series/${SERIES}/measurements`, () =>
    HttpResponse.json({
      seriesUid: SERIES,
      frameOfReferenceUid: '1.2.9',
      srSeriesUid: null,
      srSopUid: null,
      parseError: null,
      measurements: [],
    }),
  ),
  http.put(`${API}/api/series/${SERIES}/measurements`, async ({ request }) => {
    const body = (await request.json()) as { measurements: unknown[] };
    return HttpResponse.json({
      seriesUid: SERIES,
      frameOfReferenceUid: '1.2.9',
      srSeriesUid: '1.2.9.1',
      srSopUid: '1.2.9.2',
      parseError: null,
      measurements: body.measurements,
    });
  }),
```

- [ ] **Step 7: Run to verify it passes**

Run: `cd frontend && npx vitest run src/cornerstone/annotations.test.ts`
Expected: 5 passed.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/api frontend/src/cornerstone/annotations.ts frontend/src/cornerstone/annotations.test.ts frontend/src/test/msw.ts
git commit -m "Add the measurement transport and annotation adapter"
```

---

## Task 6: Tool registration and the measurements hook

**Files:**
- Create: `frontend/src/hooks/useMeasurements.ts`, `frontend/src/hooks/useMeasurements.test.tsx`
- Modify: `frontend/src/cornerstone/toolGroups.ts`

**Interfaces:**
- Consumes: Task 5's adapter and transport.
- Produces:
  - `type MprTool = 'crosshairs' | 'windowLevel' | ToolName`
  - `setActiveMprTool(tool: MprTool): void`, replacing `setCrosshairsActive`
  - `useMeasurements(seriesUid: string, ready: boolean): MeasurementsState` with fields `status`, `set`, `parseError`, `dirty`, `saving`, `error`, `markDirty`, `save`

- [ ] **Step 1: Register the four tools**

In `frontend/src/cornerstone/toolGroups.ts`, extend the import:

```ts
import {
  AngleTool,
  CrosshairsTool,
  EllipticalROITool,
  Enums,
  LengthTool,
  PanTool,
  ProbeTool,
  StackScrollTool,
  ToolGroupManager,
  TrackballRotateTool,
  WindowLevelTool,
  ZoomTool,
} from '@cornerstonejs/tools';
import type { ToolName } from '../api/types';

export type MprTool = 'crosshairs' | 'windowLevel' | ToolName;

// Measurement tools are registered on the MPR group only. The 3D volume
// viewport has no in-plane geometry to measure against, and these tools throw
// when handed a VOLUME_3D viewport.
const MEASURE_TOOLS = [LengthTool, AngleTool, ProbeTool, EllipticalROITool];
const PRIMARY = [{ mouseButton: MouseBindings.Primary }];
```

Inside `createToolGroups`, after the `mpr.addTool(CrosshairsTool.toolName, {...})`
call, add:

```ts
  for (const Tool of MEASURE_TOOLS) mpr.addTool(Tool.toolName);
```

and change `setCrosshairsActive(true)` to `setActiveMprTool('crosshairs')`.

Replace `setCrosshairsActive` entirely:

```ts
/**
 * Exactly one tool owns left-drag at a time. Everything else that could own it
 * is set passive (still rendered, still grabbable by its handles) or, for
 * crosshairs, disabled, since its reference lines would otherwise stay
 * interactive and swallow the drag.
 */
export function setActiveMprTool(tool: MprTool): void {
  const mpr = ToolGroupManager.getToolGroup(MPR_TOOL_GROUP);
  if (!mpr) return;
  mpr.setToolDisabled(CrosshairsTool.toolName);
  mpr.setToolPassive(WindowLevelTool.toolName);
  for (const T of MEASURE_TOOLS) mpr.setToolPassive(T.toolName);

  if (tool === 'crosshairs') mpr.setToolActive(CrosshairsTool.toolName, { bindings: PRIMARY });
  else if (tool === 'windowLevel')
    mpr.setToolActive(WindowLevelTool.toolName, { bindings: PRIMARY });
  else mpr.setToolActive(tool, { bindings: PRIMARY });
}
```

Its two callers in `ViewerLayout.tsx` are updated in Task 7.

- [ ] **Step 2: Write the failing hook test**

Create `frontend/src/hooks/useMeasurements.test.tsx`:

```tsx
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import { expect, test, vi } from 'vitest';
import { useMeasurements } from './useMeasurements';
import { API, SERIES, server } from '../test/msw';

vi.mock('../cornerstone/annotations', () => ({
  loadAnnotations: vi.fn(),
  clearAnnotations: vi.fn(),
  readAnnotations: vi.fn(() => [
    {
      id: 'a',
      tool: 'Length',
      points: [
        [0, 0, 0],
        [3, 4, 0],
      ],
      plane: { normal: [0, 0, 1], up: [0, -1, 0] },
      values: [{ name: 'Length', value: 5, unit: 'mm' }],
      label: null,
    },
  ]),
}));

const wrap = ({ children }: { children: React.ReactNode }) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    {children}
  </QueryClientProvider>
);

test('loads on mount and is not dirty', async () => {
  const { result } = renderHook(() => useMeasurements(SERIES, true), { wrapper: wrap });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.dirty).toBe(false);
  expect(result.current.parseError).toBeNull();
});

test('markDirty then save sends what Cornerstone holds and clears dirty', async () => {
  const { result } = renderHook(() => useMeasurements(SERIES, true), { wrapper: wrap });
  await waitFor(() => expect(result.current.status).toBe('ready'));

  act(() => result.current.markDirty());
  expect(result.current.dirty).toBe(true);

  await act(async () => {
    await result.current.save();
  });
  await waitFor(() => expect(result.current.dirty).toBe(false));
});

test('a save conflict surfaces as an error without clearing dirty', async () => {
  server.use(
    http.put(`${API}/api/series/${SERIES}/measurements`, () =>
      HttpResponse.json({ detail: 'report changed since it was loaded' }, { status: 409 }),
    ),
  );
  const { result } = renderHook(() => useMeasurements(SERIES, true), { wrapper: wrap });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  act(() => result.current.markDirty());

  await act(async () => {
    await result.current.save();
  });

  await waitFor(() => expect(result.current.error).toMatch(/changed since/));
  expect(result.current.dirty).toBe(true);
});

test('a parse error is surfaced and leaves the viewer usable', async () => {
  server.use(
    http.get(`${API}/api/series/${SERIES}/measurements`, () =>
      HttpResponse.json({
        seriesUid: SERIES,
        frameOfReferenceUid: '1.2.9',
        srSeriesUid: '1.2.9.1',
        srSopUid: '1.2.9.2',
        parseError: 'SrParseError: no measurement groups found',
        measurements: [],
      }),
    ),
  );
  const { result } = renderHook(() => useMeasurements(SERIES, true), { wrapper: wrap });
  await waitFor(() => expect(result.current.status).toBe('ready'));
  expect(result.current.parseError).toMatch(/no measurement groups/);
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd frontend && npx vitest run src/hooks/useMeasurements.test.tsx`
Expected: FAIL, cannot resolve `./useMeasurements`.

- [ ] **Step 4: Write the hook**

Create `frontend/src/hooks/useMeasurements.ts`:

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { getMeasurements, putMeasurements } from '../api/measurements';
import type { MeasurementSet } from '../api/types';
import { clearAnnotations, loadAnnotations, readAnnotations } from '../cornerstone/annotations';

export interface MeasurementsState {
  status: 'loading' | 'ready' | 'error';
  set: MeasurementSet | null;
  parseError: string | null;
  dirty: boolean;
  saving: boolean;
  error: string | null;
  markDirty: () => void;
  save: () => Promise<void>;
}

export function useMeasurements(seriesUid: string, ready: boolean): MeasurementsState {
  const qc = useQueryClient();
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Keyed to the series, not a bare boolean: switching series without
  // remounting must load the new one rather than leave the old set on screen.
  const loadedFor = useRef<string | null>(null);

  const q = useQuery({
    queryKey: ['measurements', seriesUid],
    queryFn: () => getMeasurements(seriesUid),
    enabled: Boolean(seriesUid),
  });

  const forUid = q.data?.frameOfReferenceUid ?? '';

  useEffect(() => {
    if (!ready || !q.data || loadedFor.current === seriesUid) return;
    clearAnnotations();
    loadAnnotations(q.data.measurements, forUid);
    loadedFor.current = seriesUid;
    setDirty(false);
    setError(null);
  }, [ready, q.data, seriesUid, forUid]);

  useEffect(
    () => () => {
      clearAnnotations();
      loadedFor.current = null;
    },
    [seriesUid],
  );

  const mutation = useMutation({
    mutationFn: () => putMeasurements(seriesUid, q.data?.srSopUid ?? null, readAnnotations(forUid)),
    onSuccess: (next) => {
      qc.setQueryData(['measurements', seriesUid], next);
      setDirty(false);
      setError(null);
    },
    onError: (e: Error) => setError(e.message),
  });

  return {
    status: q.isPending ? 'loading' : q.isError ? 'error' : 'ready',
    set: q.data ?? null,
    parseError: q.data?.parseError ?? null,
    dirty,
    saving: mutation.isPending,
    error: error ?? (q.isError ? q.error.message : null),
    markDirty: () => setDirty(true),
    save: async () => {
      try {
        await mutation.mutateAsync();
      } catch {
        /* surfaced through `error` by onError */
      }
    },
  };
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `cd frontend && npx vitest run src/hooks/useMeasurements.test.tsx`
Expected: 4 passed.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/cornerstone/toolGroups.ts frontend/src/hooks/useMeasurements.ts frontend/src/hooks/useMeasurements.test.tsx
git commit -m "Register measurement tools and add the measurements hook"
```

---

## Task 7: Toolbar and viewer wiring

**Files:**
- Modify: `frontend/src/components/viewer/Toolbar.tsx`, `frontend/src/components/viewer/ViewerLayout.tsx`, `frontend/src/components/viewer/ViewerPage.tsx`, `frontend/src/components/viewer/Toolbar.test.tsx`

**Interfaces:**
- Consumes: Task 6's `setActiveMprTool`, `MprTool`, `useMeasurements`.
- Produces: no exported names beyond the changed component props.

- [ ] **Step 1: Update the Toolbar props and UI**

In `Toolbar.tsx`, replace `crosshairs: boolean; onCrosshairs: (on: boolean) => void;`
in `ToolbarProps` with:

```ts
  tool: MprTool;
  onTool: (t: MprTool) => void;
  dirty: boolean;
  saving: boolean;
  canMeasure: boolean;
  onSave: () => void;
  reportUrl: string | null;
```

Add the mode selector, reusing the existing `Button` and its `active` prop.
Before writing the import, confirm each icon name is exported by
`@phosphor-icons/react`; substitute `Triangle` for `AngleIcon` and `Circle` for
`EllipseIcon` if they are not.

```tsx
const MODES: { id: MprTool; label: string; Icon: typeof Crosshair }[] = [
  { id: 'crosshairs', label: 'Crosshairs', Icon: Crosshair },
  { id: 'windowLevel', label: 'Window', Icon: CircleHalf },
  { id: 'Length', label: 'Length', Icon: Ruler },
  { id: 'Angle', label: 'Angle', Icon: Triangle },
  { id: 'Probe', label: 'Probe', Icon: Target },
  { id: 'EllipticalROI', label: 'Ellipse', Icon: Circle },
];

const isMeasure = (id: MprTool) => id !== 'crosshairs' && id !== 'windowLevel';
```

Render it in place of the old Crosshairs button:

```tsx
      <div className="flex items-center gap-1" role="group" aria-label="Tool mode">
        {MODES.map(({ id, label, Icon }) => (
          <Button
            key={id}
            active={p.tool === id}
            disabled={!p.canMeasure && isMeasure(id)}
            title={
              !p.canMeasure && isMeasure(id)
                ? 'This series has no frame of reference, so it cannot be measured'
                : label
            }
            onClick={() => p.onTool(id)}
          >
            <Icon aria-hidden size={15} />
            {label}
          </Button>
        ))}
      </div>
```

After the two selects, add save and download:

```tsx
      <Button
        variant={p.dirty ? 'primary' : 'quiet'}
        disabled={!p.dirty || p.saving}
        onClick={p.onSave}
      >
        {p.saving ? 'Saving' : p.dirty ? 'Save measurements' : 'Saved'}
      </Button>
      {p.reportUrl && (
        <a className="text-xs text-accent underline" href={p.reportUrl} download>
          Download report
        </a>
      )}
```

Keep `Invert`, `Reset` and both selects exactly as they are, including their
accessible names: `Toolbar.test.tsx` and the e2e test match on `/invert/i`,
`/reset/i`, `MPR window` and `3D preset`.

- [ ] **Step 2: Update ViewerLayout**

In `ViewerLayout.tsx`:

- Replace `const [crosshairs, setCrosshairs] = useState(true);` with
  `const [tool, setTool] = useState<MprTool>('crosshairs');`
- Replace the `onCrosshairs` function with:

```tsx
  const onTool = (t: MprTool) => {
    setTool(t);
    setActiveMprTool(t);
    engine()?.render();
  };
```

- In `onReset`'s `.then(...)`, replace `setCrosshairsActive(crosshairs)` with
  `setActiveMprTool(tool)`. Keep the existing comment above it verbatim; it
  still explains exactly why the call is there.
- In the keyboard effect, replace the `'c'` case body with
  `onTool(tool === 'crosshairs' ? 'windowLevel' : 'crosshairs');` and change the
  dependency array from `[crosshairs, volumeId, modality]` to
  `[tool, volumeId, modality]`.
- Add props `dirty`, `saving`, `canMeasure`, `onSave`, `reportUrl`,
  `onAnnotationChange: () => void`, and forward the first five to `Toolbar`
  along with `tool` and `onTool`.
- Subscribe to annotation events so drawing marks the set dirty:

```tsx
  // Cornerstone fires annotation events on its global eventTarget, not on a
  // viewport element.
  useEffect(() => {
    const mark = () => onAnnotationChange();
    const events = [
      csToolsEnums.Events.ANNOTATION_COMPLETED,
      csToolsEnums.Events.ANNOTATION_MODIFIED,
      csToolsEnums.Events.ANNOTATION_REMOVED,
    ];
    for (const e of events) eventTarget.addEventListener(e, mark);
    return () => {
      for (const e of events) eventTarget.removeEventListener(e, mark);
    };
  }, [onAnnotationChange]);
```

with `import { eventTarget, getRenderingEngine, type Types } from '@cornerstonejs/core';`
and `import { Enums as csToolsEnums } from '@cornerstonejs/tools';`.

- [ ] **Step 3: Update ViewerPage**

In `ViewerPage.tsx`, call the hook and build the report link:

```tsx
  const m = useMeasurements(seriesUid, v.status === 'ready');
  const reportUrl =
    m.set?.srSeriesUid && m.set.srSopUid
      ? apiUrl(
          `/dicomweb/studies/${studyUid}/series/${m.set.srSeriesUid}/instances/${m.set.srSopUid}`,
        )
      : null;
```

with `import { apiUrl } from '../../api/client';`.

Pass to `ViewerLayout`: `dirty={m.dirty}`, `saving={m.saving}`,
`canMeasure={Boolean(m.set?.frameOfReferenceUid)}`,
`onSave={() => void m.save()}`, `reportUrl={reportUrl}`,
`onAnnotationChange={m.markDirty}`.

Render the two non-blocking notices inside the same relative container that
holds `ViewerLayout`:

```tsx
          {m.parseError && (
            <div
              role="status"
              className="absolute inset-x-2 top-2 z-20 rounded-control border border-warn/40 bg-warn/10 px-3 py-2 text-xs text-warn"
            >
              A report exists for this series but could not be read. Measuring and saving will
              replace it.
            </div>
          )}
          {m.error && (
            <div
              role="alert"
              className="absolute inset-x-2 top-2 z-20 rounded-control border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
            >
              {m.error}
            </div>
          )}
```

- [ ] **Step 4: Update the Toolbar test**

In `Toolbar.test.tsx`, extract a shared `baseProps` object so all three tests
use it:

```tsx
const baseProps = {
  modality: 'CT',
  tool: 'crosshairs' as const,
  onTool: vi.fn(),
  voiPresetName: '',
  onVoiPreset: vi.fn(),
  volPresetName: 'CT-Bone',
  onVolumePreset: vi.fn(),
  onInvert: vi.fn(),
  onReset: vi.fn(),
  dirty: false,
  saving: false,
  canMeasure: true,
  onSave: vi.fn(),
  reportUrl: null,
};
```

Replace the crosshairs assertion in the CT test with:

```tsx
  await userEvent.click(screen.getByRole('button', { name: /length/i }));
  expect(onTool).toHaveBeenCalledWith('Length');
```

and add:

```tsx
test('measurement modes are disabled when the series cannot be measured', () => {
  render(<Toolbar {...baseProps} canMeasure={false} />);
  expect(screen.getByRole('button', { name: /length/i })).toBeDisabled();
  expect(screen.getByRole('button', { name: /crosshairs/i })).toBeEnabled();
});

test('save is disabled until something changes', () => {
  const onSave = vi.fn();
  const { rerender } = render(<Toolbar {...baseProps} onSave={onSave} />);
  expect(screen.getByRole('button', { name: /saved/i })).toBeDisabled();
  rerender(<Toolbar {...baseProps} dirty onSave={onSave} />);
  expect(screen.getByRole('button', { name: /save measurements/i })).toBeEnabled();
});
```

- [ ] **Step 5: Run the viewer component tests**

Run: `cd frontend && npx vitest run src/components/viewer`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/viewer
git commit -m "Add measurement tool modes, save and report download to the viewer"
```

---

## Task 8: End-to-end persistence test and documentation

**Files:**
- Modify: `frontend/e2e/viewer.spec.ts`, `docs/trd.md`, `docs/architecture.md`, `docs/data-flow.md`, `README.md`

**Interfaces:**
- Consumes: everything.
- Produces: nothing importable.

- [ ] **Step 1: Write the end-to-end test**

Append to `frontend/e2e/viewer.spec.ts`:

```ts
test('a measurement survives a reload as a stored Structured Report', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('/');
  await page.getByRole('row', { name: /Test\^Patient/ }).click();
  await page.getByRole('link', { name: /Synthetic series/ }).click();
  await expect(page.getByRole('progressbar')).toBeHidden({ timeout: 90_000 });

  await page.getByRole('button', { name: /length/i }).click();
  const box = (await page.getByTestId('panel-Axial').boundingBox())!;
  await page.mouse.move(box.x + box.width * 0.35, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.65, box.y + box.height * 0.5, { steps: 10 });
  await page.mouse.up();

  const save = page.getByRole('button', { name: /save measurements/i });
  await expect(save).toBeEnabled({ timeout: 15_000 });
  await save.click();
  await expect(page.getByRole('button', { name: /^saved$/i })).toBeVisible({ timeout: 30_000 });

  await page.reload();
  await expect(page.getByRole('progressbar')).toBeHidden({ timeout: 90_000 });
  // The download link only appears when the backend reported an srSopUid,
  // which means it wrote, indexed and then parsed a real DICOM SR.
  await expect(page.getByRole('link', { name: /download report/i })).toBeVisible({
    timeout: 30_000,
  });
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run the end-to-end suite**

Make sure nothing else holds port 8001 or 5173 first; the Playwright config
starts its own servers with `reuseExistingServer: false`.

Run: `cd frontend && npx playwright test`
Expected: 2 passed.

If the length drag does not register, check in a `page.evaluate` that
`setActiveMprTool('Length')` actually bound left-drag. Do not weaken the
assertion to make it pass.

- [ ] **Step 3: Update the TRD**

In `docs/trd.md`:

- Move measurements and annotations out of the "**Out:**" list in section 1 and
  add them to "**In:**".
- Add to the section 3 table:

```
| F16 | Measure length, angle, probe and elliptical ROI on the MPR planes in real units | `cornerstone/annotations.ts`, `toolGroups.ts` | `annotations.test.ts`, e2e |
| F17 | Persist measurements as a Comprehensive 3D SR in the store, round-tripped on reopen | `app/sr/*`, `api/measurements.py` | `test_sr_build_parse.py`, `test_measurements_api.py` |
| F18 | Reject a measurement whose stated value disagrees with its own coordinates | `app/sr/validate.py` | `test_sr_validate.py` |
```

- Add to the section 4 table:

```
| N9 | A report that cannot be read must never stop the series opening | `GET` returns an empty set with `parseError`; the viewer shows a non-blocking notice |
| N10 | A concurrent save must not silently overwrite another client's work | Optimistic `srSopUid` check, 409 on mismatch |
```

- Add to the section 5 endpoint list:

```
GET  /api/series/{series_uid}/measurements         -> wire JSON
PUT  /api/series/{series_uid}/measurements         -> wire JSON with the new srSopUid
```

- Add to section 7, known limitations:

```
- The view plane a measurement was drawn on has no slot in TID 1500, so it is
  written as additional numeric content items under a private coding scheme
  (`99DICOMVIEWER`). A foreign reader ignores them and still reads the
  measurement; ours needs them to restore the annotation to the right plane.
- Only reports this application wrote are parsed. A third-party SR is reported
  as unreadable rather than partially interpreted.
- Probe and ROI statistics are recorded on the client's word. Only length and
  angle are verified against their own coordinates.
```

- [ ] **Step 4: Update architecture and data flow**

In `docs/architecture.md`, add `sr/ build · parse · validate` to the backend
column of the diagram, change the Domain row of the backend layer table to:

```
| Domain | `geometry.py`, `sr/` | Slice ordering, 3D-grid validation, SR construction and parsing. The only imaging maths. |
```

and add a decision bullet:

```
- **Measurements are DICOM objects, not rows.** A Structured Report is written
  into the store as its own series and parsed back on read, so the measurement
  is the standard object rather than a private table that happens to export one.
```

In `docs/data-flow.md`, add a fourth section titled
`## 4. Measure - annotation to Structured Report and back`, containing the two
diagrams from section 7 of the spec, plus the error-path rows for a parse
failure and a 409.

- [ ] **Step 5: Update the README**

In `README.md`, add to the DICOM standards list:

```
- **Structured Reporting (TID 1500)** - measurements are stored as a
  Comprehensive 3D SR in the study, indexed as its own series, retrievable over
  WADO-RS and parsed back when the series is reopened.
```

Remove measurements and annotations from the "Not included" line, and drop them
from the Roadmap line, which keeps segmentation and surface export.

- [ ] **Step 6: Commit**

```bash
git add frontend/e2e docs README.md
git commit -m "Add the measurement persistence e2e test and document SR support"
```

---

## Task 9: Single verification pass

Per the user's instruction, this is the only place the full suite runs.

- [ ] **Step 1: Backend suite, lint and types**

```bash
cd backend && .venv/Scripts/python.exe -m pytest -q
.venv/Scripts/python.exe -m ruff check app tests
.venv/Scripts/python.exe -m mypy --strict app
```

Expected: all pass, zero warnings. Fix anything that fails before continuing.

- [ ] **Step 2: Frontend suite, lint, types and format**

```bash
cd frontend && npx tsc -b --noEmit && npx vitest run && npx oxlint src && npx prettier --check src
```

Expected: all pass. The only acceptable oxlint output is the two pre-existing
warnings in `src/hooks/useVolume.ts` and `src/hooks/useVolume.test.tsx`.

- [ ] **Step 3: Full script and end to end**

```bash
./scripts/test.ps1
cd frontend && npx playwright test
```

Expected: `test.ps1` exits 0; Playwright reports 2 passed.

- [ ] **Step 4: Live check against real data**

Start both servers, open a brain series, draw a length, save, reload, and
confirm the measurement returns and the download link appears. Then confirm the
SR series shows in the study browser as a greyed card reading "structured
report, not an image series".

- [ ] **Step 5: Update the counts**

Replace the test counts in `README.md` and in `docs/trd.md` section 6 with the
numbers actually reported in steps 1 to 3.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "Update test counts after the measurements feature"
```

---

## Self-Review

**Spec coverage.** Section 1 goal: Tasks 2 to 4 and 7. Section 2 in scope: all
four tools in Tasks 3, 6 and 7; round trip in Tasks 2, 3 and 8; explicit save in
Task 6. Section 2 out of scope respected: no third-party SR parsing, no
3D-viewport measurement, no extra tools. Section 3 approach: Tasks 2 and 4.
Section 4 wire format: Tasks 2 and 5, with the `id` and `label` tracking slots in
Task 2 step 4, the plane extension in Task 2 step 4, and value verification in
Task 4 step 3. Section 5 backend: Tasks 1 to 4. Section 6 frontend: Tasks 5 to 7.
Section 7 data flow: Tasks 4, 6 and 7. Section 8 error handling: save ordering in
Task 4 step 7, the 409 in Task 4, all five 422 cases in Task 4 step 1, unreadable
report in Tasks 4 and 7, missing frame of reference in Tasks 4 and 7. Section 9
testing: every bullet has a task. Section 10 dependency: Task 1 step 9. Section
11 risks: the Length-first ordering is honoured by Tasks 2 and 3 being separate,
and the plane extension is documented in Task 8 step 3.

**Gaps found and closed while reviewing.** The spec did not mention that
`repo.upsert_instance` is a positional insert that breaks on any new column, nor
that `api/volume.py` would raise `TypeError` once the image fields are nullable.
Both are now Task 1 steps 5 and 8, each with a test. The spec also did not say
where the `CREATE INDEX` runs for an already-existing database; Task 1 step 3
now says it belongs inside `_migrate`.

**Placeholder scan.** No TBD, no "add error handling", no "similar to Task N".
Every code step carries its code. Task 3 step 3 is the one place that says "fix
whatever the failures name", and it enumerates the three specific causes with
the specific fix for each, because the exact shape highdicom demands for an
ELLIPSE region cannot be known without running it.

**Type consistency.** `MeasurementItem`, `MeasurementValue`, `Plane` and
`MeasurementSet` are spelled identically in Python (Task 2) and TypeScript
(Task 5). `build_sr`, `parse_sr`, `validate_set`, `find_derived_series`,
`set_derived_from`, `delete_instance`, `setActiveMprTool`, `useMeasurements`,
`toWire`, `fromWire`, `loadAnnotations`, `readAnnotations` and
`clearAnnotations` are each defined once and used under that name everywhere.
Wire `tool` values are exactly Cornerstone's tool names, so no translation table
is needed between the two sides.
