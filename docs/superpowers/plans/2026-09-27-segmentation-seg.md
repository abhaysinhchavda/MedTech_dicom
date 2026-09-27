# Painted Segmentation with DICOM SEG - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user paint a segmentation on the MPR planes and persist it as a real DICOM Segmentation object stored, indexed and served beside the images.

**Architecture:** Cornerstone paints into a derived labelmap volume. The mask crosses the wire as a plain uint8 label volume; the backend splits it into per-segment binary planes and writes a BINARY SEG with `highdicom`, and recombines on read. No DICOM parsing is added to the browser.

**Tech Stack:** Python 3.12, FastAPI, pydicom 3, highdicom 0.28.1, SQLite. React 19, TypeScript 6 strict, Cornerstone3D 5.10 segmentation module, TanStack Query 5, vitest + MSW, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-27-segmentation-dicom-seg-design.md`

## Global Constraints

- **Verification is batched.** Each task runs only its own new tests. The full suite, lint, typecheck and e2e run once, in Task 9.
- Branch is `MedTech_dicom`. **Not** `feature/dicom-viewer`, which sits at `6f81f76` and predates the measurements feature. Never push, never merge to main.
- Backend: `mypy --strict` clean over `app/`, `ruff` clean. All SQL in `app/repo.py`. `app/segmentation/` has no HTTP and no SQL imports.
- Frontend: TypeScript `strict`, `oxlint` clean, Prettier formatted. Only `src/cornerstone/*` may import from `@cornerstonejs/*`.
- Zero em-dash characters in user-visible strings.
- **No new dependencies.** `highdicom` and Cornerstone's segmentation module are both already installed.
- Commit after each task, message ending `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

## Baseline before this work

127 backend tests, 55 frontend tests, 2 Playwright tests, ruff clean, mypy clean on 28 files, prettier clean, oxlint with exactly 2 pre-existing warnings (`src/hooks/useVolume.ts:63`, `src/hooks/useVolume.test.tsx:196`).

## GateGuard

A repo hook rejects the first Edit/Write of each file and the first Bash command, demanding facts. Recovery is always: state importers/callers, affected API, data schemas, and the user's verbatim instruction ("good to go, make the plan and implement"), then retry the identical call. It succeeds on retry.

## Verified API facts

Confirmed by introspection. Do not substitute.

```python
hd.seg.Segmentation(
    source_images, pixel_array, segmentation_type, segment_descriptions,
    series_instance_uid, series_number, sop_instance_uid, instance_number,
    manufacturer, manufacturer_model_name, software_versions, device_serial_number,
    ..., omit_empty_frames=True, ...)

hd.seg.SegmentDescription(
    segment_number, segment_label, segmented_property_category,
    segmented_property_type, algorithm_type, algorithm_identification=None,
    tracking_uid=None, tracking_id=None, ...)

hd.seg.Segmentation.from_dataset(ds)
seg.get_pixels_by_source_frame(source_sop_instance_uid, source_frame_numbers=None,
    segment_numbers=None, combine_segments=False, relabel=False,
    assert_missing_frames_are_empty=False, ...)

hd.seg.SegmentationTypeValues:      BINARY, FRACTIONAL, LABELMAP
hd.seg.SegmentAlgorithmTypeValues:  AUTOMATIC, SEMIAUTOMATIC, MANUAL
```

Coded concepts, verified against pydicom's dictionary:
`codes.SCT.MorphologicallyAbnormalStructure` = 49755003 (category),
`codes.SCT.NeoplasmPrimary` = 372087000 (type),
`codes.SCT.Neoplasm` = 108369006 (more general alternative).
The naive guess `86049000` is **wrong**; this is the third coded concept in
this project where the obvious guess failed.

Cornerstone:
```ts
volumeLoader.createAndCacheDerivedLabelmapVolume(referencedVolumeId, options?)
segmentation.addSegmentations([{ segmentationId, representation: { type, data } }])
segmentation.addSegmentationRepresentations(viewportId, [{ segmentationId, type }])
segmentation.removeSegmentation(segmentationId)
utilities.segmentation.setBrushSizeForToolGroup(toolGroupId, size)
```
The exact path of the active-segment-index setter is in
`stateManagement/segmentation/` and must be located at implementation time
(`getActiveSegmentIndex.js` exists; find its setter sibling before writing the
toolbar wiring).

## Two behaviours to get right

1. **`omit_empty_frames` defaults to `True`.** For a small tumour in a 160-slice volume that is a large saving, so keep it. It means the read side must pass `assert_missing_frames_are_empty=True`, or a slice with no paint raises instead of returning zeros.
2. **`combine_segments=True, relabel=False`** on read returns a single array whose values are the original segment numbers. That is exactly the label volume, so no recombination loop is needed beyond stacking slices.

---

## File Structure

**Backend, created**

| File | Responsibility |
|---|---|
| `app/segmentation/__init__.py` | Re-exports. |
| `app/segmentation/models.py` | `Segment`, `SegmentationSet` dataclasses. No I/O. |
| `app/segmentation/mask.py` | uint8 label volume to per-segment binary planes and back. Pure, numpy only. |
| `app/segmentation/build.py` | planes + segments to a `Segmentation` dataset. Pure. |
| `app/segmentation/parse.py` | SEG dataset to label volume + segments. Pure. `SegParseError`. |
| `app/segmentation/validate.py` | dims, byte length, declared segments. `SegValidationError`. |
| `app/api/segmentations.py` | the three routes. |
| `tests/test_seg_mask.py` | codec round trips. |
| `tests/test_seg_build_parse.py` | SEG round trip and dataset assertions. |
| `tests/test_segmentations_api.py` | endpoints, 422, 409, delete-on-empty. |

**Backend, modified:** `app/ingest/reader.py` (SEG SOP class constant), `app/ingest/indexer.py` (SEG reason), `app/main.py` (router).

**Frontend, created:** `src/api/segmentation.ts`, `src/cornerstone/segmentation.ts`, `src/hooks/useSegmentation.ts`, plus `segmentation.test.ts` and `useSegmentation.test.tsx`.

**Frontend, modified:** `src/cornerstone/init.ts`, `src/cornerstone/toolGroups.ts`, `src/components/viewer/Toolbar.tsx`, `src/components/viewer/ViewerPage.tsx`, `src/components/viewer/ViewerLayout.tsx`, `src/test/msw.ts`, `e2e/viewer.spec.ts`.

---

## Task 1: Recognise a segmentation on ingest

**Files:** Modify `backend/app/ingest/reader.py`, `backend/app/ingest/indexer.py`. Test: `backend/tests/test_non_image_instances.py`.

**Interfaces produced:** `reader.SEG_SOP_CLASS: str`.

- [ ] **Step 1: Write the failing test**

Append to `backend/tests/test_non_image_instances.py`:

```python
SEGMENTATION_STORAGE = "1.2.840.10008.5.1.4.1.1.66.4"


def make_seg(tmp_path: Path, study_uid: str, series_uid: str, frames: int = 4) -> Path:
    """A minimal multi-frame SEG. It HAS PixelData, unlike an SR."""
    import numpy as np

    ds = Dataset()
    ds.SOPClassUID = SEGMENTATION_STORAGE
    ds.SOPInstanceUID = generate_uid()
    ds.SeriesInstanceUID = series_uid
    ds.StudyInstanceUID = study_uid
    ds.Modality = "SEG"
    ds.SeriesNumber = 98
    ds.InstanceNumber = 1
    ds.Rows, ds.Columns = 8, 8
    ds.NumberOfFrames = frames
    ds.BitsAllocated, ds.BitsStored, ds.HighBit = 8, 8, 7
    ds.SamplesPerPixel = 1
    ds.PixelRepresentation = 0
    ds.PhotometricInterpretation = "MONOCHROME2"
    ds.PixelData = np.zeros((frames, 8, 8), dtype=np.uint8).tobytes()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = ds.SOPClassUID
    ds.file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
    path = tmp_path / "seg.dcm"
    pydicom.dcmwrite(path, ds, enforce_file_format=True)
    return path


def test_seg_is_greyed_with_an_honest_reason(tmp_path: Path, settings: Settings) -> None:
    conn = connect(settings.db_path)
    init_schema(conn)
    study_uid, series_uid = generate_uid(), generate_uid()

    summary = ingest_files(conn, [make_seg(tmp_path, study_uid, series_uid)], settings.store_dir)

    assert summary.accepted == 1
    series = repo.get_series(conn, series_uid)
    assert series is not None
    assert series.modality == "SEG"
    assert series.volume.is_volume is False
    # Not "irregular slice spacing": that reason is true of any multi-frame
    # instance and tells the user nothing about what this object is.
    assert series.volume.reason == "segmentation, not an image series"
    assert series.thumb_sop_uid is None
    conn.close()
```

- [ ] **Step 2: Run to verify it fails**

`cd backend && .venv/Scripts/python.exe -m pytest tests/test_non_image_instances.py -q`
Expected: FAIL, reason is `"irregular slice spacing"`.

- [ ] **Step 3: Add the SOP class constant**

In `backend/app/ingest/reader.py`, beside `SR_SOP_CLASSES`:

```python
# A Segmentation carries PixelData, so unlike an SR it passes the image
# required-tag set unchanged. It is named here only so the indexer can give it
# an honest reason when the volume check rejects it.
SEG_SOP_CLASS = "1.2.840.10008.5.1.4.1.1.66.4"
```

- [ ] **Step 4: Give it an honest reason**

In `backend/app/ingest/indexer.py::finalize_series`, after the existing
non-image short-circuit and before the geometry path:

```python
    if rows and all(r.sop_class_uid == SEG_SOP_CLASS for r in rows):
        # A segmentation is an overlay, never an openable volume. The volume
        # check would reject it as "irregular slice spacing", which is true of
        # any multi-frame instance and says nothing useful.
        with conn:
            repo.update_series_finalized(
                conn,
                series_uid,
                instance_count=len(rows),
                frame_count=sum(r.num_frames or 0 for r in rows),
                thumb_sop_uid=None,
                sort_method="instance-number",
                volume=VolumeInfo(False, "segmentation, not an image series"),
            )
        seg_series = repo.get_series(conn, series_uid)
        assert seg_series is not None
        return seg_series
```

Import `SEG_SOP_CLASS` from `app.ingest.reader`.

- [ ] **Step 5: Run to verify it passes** (expect 6 passed in that file)

- [ ] **Step 6: Commit** `git commit -m "Recognise a segmentation series on ingest"`

---

## Task 2: The label-volume codec

**Files:** Create `backend/app/segmentation/__init__.py`, `models.py`, `mask.py`. Test: `backend/tests/test_seg_mask.py`.

**Interfaces produced:**
- `Segment(number, label, tracking_uid, category_code, type_code)`
- `SegmentationSet(series_uid, frame_of_reference_uid, dims, seg_series_uid, seg_sop_uid, parse_error, segments)`
- `split_segments(labels, segments) -> (n_segments, nz, ny, nx) bool`
- `combine_segments(planes, segments) -> (nz, ny, nx) uint8`
- `labels_from_bytes(raw, dims) -> np.ndarray`
- `labels_to_bytes(labels) -> bytes`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_seg_mask.py`:

```python
from __future__ import annotations

import numpy as np
import pytest

from app.segmentation import Segment
from app.segmentation.mask import (
    combine_segments,
    labels_from_bytes,
    labels_to_bytes,
    split_segments,
)

DIMS = (4, 3, 2)  # nx, ny, nz


def seg(n: int) -> Segment:
    return Segment(
        number=n,
        label=f"S{n}",
        tracking_uid=f"2.25.{n}",
        category_code="49755003",
        type_code="372087000",
    )


def labels() -> np.ndarray:
    a = np.zeros((2, 3, 4), dtype=np.uint8)  # (nz, ny, nx)
    a[0, 1, 2] = 1
    a[1, 0, 0] = 2
    a[1, 2, 3] = 1
    return a


def test_bytes_round_trip_preserves_the_voxel_order() -> None:
    a = labels()
    raw = labels_to_bytes(a)
    assert len(raw) == 4 * 3 * 2
    assert np.array_equal(labels_from_bytes(raw, DIMS), a)


def test_a_wrong_length_buffer_is_rejected() -> None:
    with pytest.raises(ValueError, match="expected 24 bytes"):
        labels_from_bytes(b"\x00" * 23, DIMS)


def test_split_then_combine_is_lossless_for_one_segment() -> None:
    a = np.zeros((2, 3, 4), dtype=np.uint8)
    a[1, 1, 1] = 1
    planes = split_segments(a, [seg(1)])
    assert planes.shape == (1, 2, 3, 4)
    assert np.array_equal(combine_segments(planes, [seg(1)]), a)


def test_split_then_combine_is_lossless_for_three_segments() -> None:
    a = labels()
    a[0, 0, 1] = 3
    segments = [seg(1), seg(2), seg(3)]
    planes = split_segments(a, segments)
    assert planes.shape == (3, 2, 3, 4)
    assert planes[0].sum() == int((a == 1).sum())
    assert planes[1].sum() == int((a == 2).sum())
    assert np.array_equal(combine_segments(planes, segments), a)


def test_segment_numbers_need_not_be_contiguous() -> None:
    a = np.zeros((2, 3, 4), dtype=np.uint8)
    a[0, 0, 0] = 7
    segments = [seg(7)]
    assert np.array_equal(combine_segments(split_segments(a, segments), segments), a)
```

- [ ] **Step 2: Run to verify it fails** (ModuleNotFoundError)

- [ ] **Step 3: Write the models**

Create `backend/app/segmentation/models.py`:

```python
from __future__ import annotations

from dataclasses import dataclass, field

Dims = tuple[int, int, int]  # nx, ny, nz


@dataclass(frozen=True)
class Segment:
    # 1-based. 0 is reserved for unlabelled, so a segment's number is also its
    # value in the label volume, which is what makes the eraser free.
    number: int
    label: str
    tracking_uid: str
    category_code: str
    type_code: str


@dataclass(frozen=True)
class SegmentationSet:
    series_uid: str
    frame_of_reference_uid: str | None
    dims: Dims | None = None
    seg_series_uid: str | None = None
    seg_sop_uid: str | None = None
    parse_error: str | None = None
    segments: list[Segment] = field(default_factory=list)
```

- [ ] **Step 4: Write the codec**

Create `backend/app/segmentation/mask.py`:

```python
from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from app.segmentation.models import Dims, Segment


def labels_from_bytes(raw: bytes, dims: Dims) -> np.ndarray:
    """Wire bytes to a (nz, ny, nx) label volume.

    The wire order is index = x + y*nx + z*nx*ny, which is Cornerstone's
    scalar data layout. numpy's C order over (nz, ny, nx) is the same walk,
    so this is a reshape and never a transpose.
    """
    nx, ny, nz = dims
    expected = nx * ny * nz
    if len(raw) != expected:
        raise ValueError(f"expected {expected} bytes for dims {dims}, got {len(raw)}")
    return np.frombuffer(raw, dtype=np.uint8).reshape((nz, ny, nx))


def labels_to_bytes(labels: np.ndarray) -> bytes:
    return np.ascontiguousarray(labels, dtype=np.uint8).tobytes()


def split_segments(labels: np.ndarray, segments: Sequence[Segment]) -> np.ndarray:
    """(nz, ny, nx) label volume to (n_segments, nz, ny, nx) boolean planes.

    DICOM BINARY segmentation stores one set of frames per segment, so this is
    the shape highdicom wants. Segments cannot overlap here by construction,
    since a voxel holds exactly one number.
    """
    if not segments:
        return np.zeros((0, *labels.shape), dtype=bool)
    return np.stack([labels == s.number for s in segments])


def combine_segments(planes: np.ndarray, segments: Sequence[Segment]) -> np.ndarray:
    """Boolean planes back to one label volume.

    Later segments win on overlap. That cannot arise from split_segments, but
    a foreign SEG can legitimately overlap, and producing a voxel value with
    no declared segment would be worse than picking one.
    """
    if not segments:
        return np.zeros(planes.shape[1:] if planes.ndim == 4 else planes.shape, dtype=np.uint8)
    out = np.zeros(planes.shape[1:], dtype=np.uint8)
    for plane, segment in zip(planes, segments, strict=True):
        out[plane.astype(bool)] = segment.number
    return out
```

Create `backend/app/segmentation/__init__.py` re-exporting `Segment`,
`SegmentationSet`, `Dims`.

- [ ] **Step 5: Run to verify it passes** (5 passed)

- [ ] **Step 6: Commit** `git commit -m "Add the segmentation label-volume codec"`

---

## Task 3: Build and parse the SEG

**Files:** Create `backend/app/segmentation/build.py`, `parse.py`. Test: `backend/tests/test_seg_build_parse.py`.

**Interfaces produced:**
- `build_seg(labels, segments, *, source_images, seg_series_uid, seg_sop_uid, series_number=98, instance_number=1) -> Dataset`
- `parse_seg(ds, source_sop_uids) -> tuple[np.ndarray, list[Segment]]`
- `class SegParseError(Exception)`

- [ ] **Step 1: Write the failing test**

Create `backend/tests/test_seg_build_parse.py`:

```python
from __future__ import annotations

import numpy as np
import pytest
from pydicom.uid import generate_uid

from app.segmentation import Segment
from app.segmentation.build import build_seg
from app.segmentation.parse import SegParseError, parse_seg
from tests.conftest import make_ct_series

SEGMENTATION_STORAGE = "1.2.840.10008.5.1.4.1.1.66.4"


def segments() -> list[Segment]:
    return [
        Segment(1, "Tumour", "2.25.101", "49755003", "372087000"),
        Segment(2, "Oedema", "2.25.102", "49755003", "372087000"),
    ]


def source_and_labels(n: int = 4, rows: int = 16, cols: int = 16):
    src = make_ct_series(n, rows=rows, cols=cols)
    labels = np.zeros((n, rows, cols), dtype=np.uint8)
    labels[1, 4:8, 4:8] = 1
    labels[2, 9:12, 2:5] = 2
    return src, labels


def build_one():
    src, labels = source_and_labels()
    ds = build_seg(
        labels,
        segments(),
        source_images=src,
        seg_series_uid=generate_uid(),
        seg_sop_uid=generate_uid(),
    )
    return src, labels, ds


def test_output_is_a_binary_segmentation() -> None:
    _, _, ds = build_one()
    assert ds.SOPClassUID == SEGMENTATION_STORAGE
    assert ds.Modality == "SEG"
    assert ds.SegmentationType == "BINARY"


def test_one_segment_sequence_item_per_segment() -> None:
    _, _, ds = build_one()
    assert len(ds.SegmentSequence) == 2
    assert [int(s.SegmentNumber) for s in ds.SegmentSequence] == [1, 2]
    assert [str(s.SegmentLabel) for s in ds.SegmentSequence] == ["Tumour", "Oedema"]


def test_tracking_uids_survive() -> None:
    _, _, ds = build_one()
    text = str(ds)
    assert "2.25.101" in text
    assert "2.25.102" in text


def test_round_trip_returns_the_identical_label_volume() -> None:
    src, labels, ds = build_one()
    back, segs = parse_seg(ds, [str(s.SOPInstanceUID) for s in src])
    assert np.array_equal(back, labels)
    assert [s.number for s in segs] == [1, 2]
    assert [s.label for s in segs] == ["Tumour", "Oedema"]


def test_a_dataset_that_is_not_a_segmentation_is_rejected() -> None:
    src = make_ct_series(1)[0]
    with pytest.raises(SegParseError):
        parse_seg(src, [str(src.SOPInstanceUID)])
```

- [ ] **Step 2: Run to verify it fails**

- [ ] **Step 3: Write the builder**

Create `backend/app/segmentation/build.py`:

```python
from __future__ import annotations

from collections.abc import Sequence

import highdicom as hd
import numpy as np
from pydicom.dataset import Dataset
from pydicom.sr.codedict import codes
from pydicom.sr.coding import Code

from app.segmentation.mask import split_segments
from app.segmentation.models import Segment

# Verified against pydicom's dictionary. The naive guess for the type code
# (86049000) does not exist; NeoplasmPrimary is 372087000.
_CATEGORIES: dict[str, Code] = {"49755003": codes.SCT.MorphologicallyAbnormalStructure}
_TYPES: dict[str, Code] = {
    "372087000": codes.SCT.NeoplasmPrimary,
    "108369006": codes.SCT.Neoplasm,
}

DEVICE = {
    "manufacturer": "DICOM 3D Brain Viewer",
    "manufacturer_model_name": "dicom-3d-brain-viewer",
    "software_versions": "1.0",
    "device_serial_number": "1",
}


def _coded(table: dict[str, Code], value: str, what: str) -> Code:
    try:
        return table[value]
    except KeyError as e:
        raise ValueError(f"unsupported {what} code {value!r}") from e


def _descriptions(segments: Sequence[Segment]) -> list[hd.seg.SegmentDescription]:
    return [
        hd.seg.SegmentDescription(
            segment_number=s.number,
            segment_label=s.label,
            segmented_property_category=_coded(_CATEGORIES, s.category_code, "category"),
            segmented_property_type=_coded(_TYPES, s.type_code, "type"),
            # The mask came from a person's hand, so MANUAL is the honest value.
            algorithm_type=hd.seg.SegmentAlgorithmTypeValues.MANUAL,
            tracking_uid=s.tracking_uid,
            tracking_id=s.label,
        )
        for s in segments
    ]


def build_seg(
    labels: np.ndarray,
    segments: Sequence[Segment],
    *,
    source_images: Sequence[Dataset],
    seg_series_uid: str,
    seg_sop_uid: str,
    series_number: int = 98,
    instance_number: int = 1,
) -> Dataset:
    planes = split_segments(labels, segments)
    # highdicom takes (frames, rows, cols) for one segment and
    # (frames, rows, cols, segments) for several, so the segment axis moves last.
    pixel_array = np.moveaxis(planes, 0, -1).astype(np.uint8)
    if pixel_array.shape[-1] == 1:
        pixel_array = pixel_array[..., 0]
    return hd.seg.Segmentation(
        source_images=list(source_images),
        pixel_array=pixel_array,
        segmentation_type=hd.seg.SegmentationTypeValues.BINARY,
        segment_descriptions=_descriptions(segments),
        series_instance_uid=seg_series_uid,
        series_number=series_number,
        sop_instance_uid=seg_sop_uid,
        instance_number=instance_number,
        # omit_empty_frames stays at its default True: a small tumour in a
        # 160-slice volume would otherwise store 160 frames of mostly zeros.
        # The read side compensates with assert_missing_frames_are_empty.
        **DEVICE,
    )
```

**Implementer note:** the single-segment squeeze above is a guess at
`highdicom`'s shape rule. Run it. If it rejects either shape, print what it
demanded and adjust, leaving a comment recording the real constraint.

- [ ] **Step 4: Write the parser**

Create `backend/app/segmentation/parse.py`:

```python
from __future__ import annotations

from collections.abc import Sequence

import highdicom as hd
import numpy as np
from pydicom.dataset import Dataset

from app.segmentation.models import Segment

SEGMENTATION_STORAGE = "1.2.840.10008.5.1.4.1.1.66.4"


class SegParseError(Exception):
    """The dataset is not a segmentation this application can read."""


def _segments(ds: Dataset) -> list[Segment]:
    out: list[Segment] = []
    for item in ds.SegmentSequence:
        category = item.SegmentedPropertyCategoryCodeSequence[0]
        ptype = item.SegmentedPropertyTypeCodeSequence[0]
        out.append(
            Segment(
                number=int(item.SegmentNumber),
                label=str(item.SegmentLabel),
                tracking_uid=str(getattr(item, "TrackingUID", "")),
                category_code=str(category.CodeValue),
                type_code=str(ptype.CodeValue),
            )
        )
    return out


def parse_seg(ds: Dataset, source_sop_uids: Sequence[str]) -> tuple[np.ndarray, list[Segment]]:
    """SEG dataset to a (nz, ny, nx) label volume plus its segments.

    `source_sop_uids` must be the reference series' instances in the same
    geometry-sorted order the volume uses: the returned array's slice axis is
    that order, and nothing inside the SEG defines it for us.
    """
    if str(ds.get("SOPClassUID", "")) != SEGMENTATION_STORAGE:
        raise SegParseError("dataset is not a Segmentation instance")
    try:
        seg = hd.seg.Segmentation.from_dataset(ds, copy=False)
    except Exception as e:  # highdicom raises several types from here
        raise SegParseError(f"{type(e).__name__}: {e}") from e

    segments = _segments(ds)
    numbers = [s.number for s in segments]
    planes = []
    for sop_uid in source_sop_uids:
        # combine_segments with relabel=False returns one array whose values
        # are the original segment numbers, which is already a label plane.
        frame = seg.get_pixels_by_source_frame(
            source_sop_instance_uid=sop_uid,
            segment_numbers=numbers,
            combine_segments=True,
            relabel=False,
            # Frames with no paint were omitted at write time.
            assert_missing_frames_are_empty=True,
        )
        arr = np.asarray(frame)
        planes.append(arr.reshape(arr.shape[-2:]))
    return np.stack(planes).astype(np.uint8), segments
```

- [ ] **Step 5: Run to verify it passes** (6 passed)

If `get_pixels_by_source_frame` returns an unexpected shape, print it and
reshape accordingly, but **do not** loosen `np.array_equal` in the round-trip
test. Exact equality is the contract.

- [ ] **Step 6: Commit** `git commit -m "Build and parse a BINARY DICOM Segmentation"`

---

## Task 4: Validation and the segmentation API

**Files:** Create `backend/app/segmentation/validate.py`, `backend/app/api/segmentations.py`. Modify `backend/app/main.py`. Test: `backend/tests/test_segmentations_api.py`.

**Interfaces produced:** `validate_set(labels, segments, *, dims, series_dims)`, `SegValidationError`; routes `GET`/`PUT /api/series/{uid}/segmentation` and `GET .../segmentation/labelmap`.

- [ ] **Step 1: Write the validator**

Create `backend/app/segmentation/validate.py`:

```python
from __future__ import annotations

import re
from collections.abc import Sequence

import numpy as np

from app.segmentation.models import Dims, Segment

_UID_RE = re.compile(r"^[0-9]+(\.[0-9]+)*$")
_UID_MAX_LEN = 64


class SegValidationError(Exception):
    """A segmentation the client sent cannot be stored as written."""


def validate_set(
    labels: np.ndarray, segments: Sequence[Segment], *, dims: Dims, series_dims: Dims
) -> None:
    if tuple(dims) != tuple(series_dims):
        raise SegValidationError(
            f"labelmap dims {tuple(dims)} do not match the series volume {tuple(series_dims)}"
        )
    seen: set[int] = set()
    for s in segments:
        if s.number < 1:
            raise SegValidationError(f"segment number {s.number} is not positive")
        if s.number in seen:
            raise SegValidationError(f"segment number {s.number} is duplicated")
        seen.add(s.number)
        if len(s.tracking_uid) > _UID_MAX_LEN or not _UID_RE.match(s.tracking_uid):
            raise SegValidationError(f"tracking uid {s.tracking_uid!r} is not a DICOM UID")
    # A painted voxel with no declared segment means the two sides disagree
    # about what was painted. Zeroing it silently would lose the user's work.
    present = {int(v) for v in np.unique(labels) if v != 0}
    undeclared = sorted(present - seen)
    if undeclared:
        raise SegValidationError(f"labelmap holds undeclared segment values {undeclared}")
```

The byte-length check lives in `mask.labels_from_bytes`, which raises
`ValueError`; the route turns it into a 422.

- [ ] **Step 2: Write the failing API test**

Create `backend/tests/test_segmentations_api.py`. Seed a 4-slice series with a
frame of reference exactly as `tests/test_measurements_api.py::seed` does
(copy that helper; duplication beats a shared fixture module for two call
sites). Helpers:

```python
def labelmap_bytes(nx: int, ny: int, nz: int, value: int = 1) -> bytes:
    import numpy as np

    a = np.zeros((nz, ny, nx), dtype=np.uint8)
    a[nz // 2, ny // 2, nx // 2] = value
    return a.tobytes()


def meta(dims, seg_sop_uid=None, number=1):
    return {
        "segSopUid": seg_sop_uid,
        "dims": list(dims),
        "segments": [
            {
                "number": number,
                "label": "Tumour",
                "trackingUid": "2.25.101",
                "categoryCode": "49755003",
                "typeCode": "372087000",
            }
        ],
    }
```

Tests, one each:
- `test_get_returns_an_empty_set_when_there_is_no_segmentation`
- `test_put_then_get_round_trips_through_the_store` (PUT; envelope has `segSopUid`; `GET .../labelmap` returns `nx*ny*nz` bytes with exactly one non-zero voxel)
- `test_the_segmentation_is_retrievable_through_wado`
- `test_saving_twice_replaces_rather_than_accumulates`
- `test_a_stale_seg_sop_uid_is_rejected` (409)
- `test_wrong_dims_are_rejected` (422, "do not match")
- `test_a_wrong_length_labelmap_is_rejected` (422)
- `test_an_undeclared_segment_value_is_rejected` (422; paint value 3, declare only segment 1)
- `test_an_all_zero_save_deletes_the_segmentation` (envelope `segSopUid` None; a following GET is empty)
- `test_a_corrupt_seg_yields_parse_error_not_a_500`

- [ ] **Step 3: Write the routes**

Create `backend/app/api/segmentations.py`, shaped on `app/api/measurements.py`,
which is the working precedent for finding the derived series, newest-wins,
the optimistic check, write-index-then-delete ordering, and the `parseError`
envelope. Differences:

- `PUT` takes `meta: str = Form(...)` (JSON text) and `labelmap: UploadFile = File(...)`.
- Series dims come from `repo.get_series(...).volume.dims`. A series with no dims cannot be segmented: 422.
- `source_images` for `build_seg` are the reference series' instances in geometry-sorted order, read with `stop_before_pixels=True`. Use `geometry.sort_instances` so the order matches the volume exactly; `parse_seg` depends on that same order.
- An all-zero labelmap deletes the file and the row and returns an envelope with `segSopUid: None`.
- `GET .../labelmap` returns `Response(labels_to_bytes(labels), media_type="application/octet-stream")` with `Content-Length`, and 404 when there is no segmentation.

- [ ] **Step 4: Register the router** in `backend/app/main.py`.

- [ ] **Step 5: Run to verify it passes**

- [ ] **Step 6: Commit** `git commit -m "Serve painted segmentations as stored DICOM SEG objects"`

---

## Task 5: Frontend transport and the Cornerstone adapter

**Files:** Create `frontend/src/api/segmentation.ts`, `frontend/src/cornerstone/segmentation.ts`, `frontend/src/cornerstone/segmentation.test.ts`. Modify `frontend/src/api/types.ts`, `frontend/src/test/msw.ts`.

**Interfaces produced:**
- types `Segment`, `SegmentationSet`
- `getSegmentation(seriesUid)`, `getLabelmap(seriesUid)`, `putSegmentation(seriesUid, segSopUid, dims, segments, labelmap)`
- `createLabelmap(referenceVolumeId, segmentationId)`, `fillLabelmap(segmentationId, bytes)`, `readLabelmap(segmentationId)`, `showSegmentation(viewportIds, segmentationId)`, `releaseSegmentation(segmentationId)`

Notes:
- `getLabelmap` returns `Uint8Array` via `res.arrayBuffer()`. `apiFetch` is JSON-only, so add a binary sibling rather than bending it.
- `putSegmentation` builds `FormData` with `meta` (a JSON string) and `labelmap` (a `Blob`).
- `segmentation.test.ts` **must mock `@cornerstonejs/tools`**, as `annotations.test.ts` does. Importing it for real starved vitest's worker pool badly enough that three unrelated test files failed to start.

- [ ] Steps: types, transport, adapter, MSW handlers, tests, commit.

---

## Task 6: The segmentation hook and brush registration

**Files:** Create `frontend/src/hooks/useSegmentation.ts` and its test. Modify `frontend/src/cornerstone/init.ts`, `frontend/src/cornerstone/toolGroups.ts`.

- Register `BrushTool` and `PaintFillTool` in `init.ts`'s global `addTool` list **and** on the MPR tool group. The global registration is load-bearing: a tool group silently ignores a tool that was never registered globally, which has bitten this project twice.
- Extend `MprTool` with `'Brush'`.
- `useSegmentation(seriesUid, ready, referenceVolumeId)` mirrors `useMeasurements`: a query, a latch keyed to `seriesUid`, dirty tracking, a mutation, and teardown calling `releaseSegmentation`.
- Set dirty from Cornerstone's segmentation-data-modified event, the way `ViewerLayout` subscribes to annotation events.

---

## Task 7: Toolbar and viewer wiring

**Files:** Modify `Toolbar.tsx`, `ViewerLayout.tsx`, `ViewerPage.tsx`, `Toolbar.test.tsx`.

- **Split the toolbar into two rows.** Row one: navigation and measurement (the seven existing modes, Invert, Reset, the two selects, the measurement Save). Row two: segmentation (Brush, a segment selector whose first entry is "Erase" for segment 0, add-segment, the segmentation Save).
- Measurements and segmentation keep **separate** dirty flags and Save buttons.
- Segmentation controls are disabled when the series has no volume dims.

---

## Task 8: End-to-end test and documentation

- Playwright: pick Brush, drag strokes on the axial panel, save, reload, assert the segment is listed and that `GET .../segmentation/labelmap` returns a body with a non-zero voxel count (via `page.request`). Do **not** assert on rendered overlay pixels; that is flaky under swiftshader.
- Update `docs/trd.md` (scope, F-rows, N-rows, endpoints, limitations), `docs/architecture.md` (the `segmentation/` module and a decision bullet), `docs/data-flow.md` (a fifth flow), `README.md` (standards list, roadmap).

---

## Task 9: Single verification pass

```
cd backend && .venv/Scripts/python.exe -m pytest -q
cd backend && .venv/Scripts/python.exe -m ruff check app tests
cd backend && .venv/Scripts/python.exe -m mypy --strict app
cd frontend && npx prettier --write src e2e && npx tsc -b --noEmit
cd frontend && npx vitest run && npx oxlint src && npx prettier --check src
./scripts/test.ps1
cd frontend && npx playwright test
```

Then a live check against the real FLAIR series, and update the test counts in
`README.md` and `docs/trd.md` section 6.

---

## Self-Review

**Spec coverage.** Section 2 in-scope: painting (Tasks 6, 7), multiple segments (Tasks 2, 4, 7), BINARY persistence (Task 3), round trip (Tasks 3, 4, 8), independent save (Task 7). Out-of-scope respected: no surface, no third-party SEG parsing, no automatic segmentation, no new dependency. Section 4 wire format: Tasks 2, 4, 5. Section 5 backend: Tasks 1 to 4, including the targeted ingest reason in Task 1 and the explicit note that this is not the multi-frame project. Section 6 frontend: Tasks 5 to 7. Section 7 data flow: Tasks 4 to 7. Section 8 error handling: dims and byte length in Tasks 2 and 4, undeclared values in Task 4, 409 and ordering in Task 4, all-zero delete in Task 4, `parseError` in Tasks 3 and 4. Section 9 testing: every bullet has a task. Section 11 risks: the `source_images` cost is measured in Task 9, the coded concepts are pinned in Task 3, brush cross-plane behaviour is confirmed in Task 8.

**Placeholder scan.** Tasks 5 to 8 are specified by interface and by the precedent they copy rather than by full code, because each is a near-duplicate of a module that already exists and is tested (`api/measurements.ts`, `cornerstone/annotations.ts`, `hooks/useMeasurements.ts`, the measurement toolbar row). That is deliberate compression against a working template, not a TODO. Tasks 1 to 4, which contain everything novel, carry their code in full.

**Type consistency.** `Segment` and `SegmentationSet` are spelled identically in Python and TypeScript. `split_segments`, `combine_segments`, `labels_from_bytes`, `labels_to_bytes`, `build_seg`, `parse_seg`, `validate_set`, and the frontend's `createLabelmap`, `fillLabelmap`, `readLabelmap`, `showSegmentation`, `releaseSegmentation` are each defined once and used under that name throughout. Segment numbers are 1-based everywhere, with 0 reserved, in the codec, the validator, the wire format and the eraser.
