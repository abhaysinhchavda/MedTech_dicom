# DICOM 3D Web Viewer — Design Spec

**Date:** 2026-09-21 (revised same day: 3D replaces the 2D stack viewer)
**Status:** Approved in brainstorming; awaiting user review of this document
**Purpose:** Portfolio / job-hunting showcase for medical-imaging roles
**Stack:** Python (FastAPI, pydicom) backend + React (Vite, TypeScript, Cornerstone3D) frontend

---

## 1. Goal

Build a browser-based **3D DICOM viewer** that demonstrates two things a
hiring manager in medical imaging screens for:

1. Understanding of the DICOM standard — a Python backend that ingests real
   studies, validates their 3D geometry, and serves them through a conformant
   **DICOMweb** subset (QIDO-RS + WADO-RS, DICOM JSON model, transfer-syntax
   handling, slice geometry).
2. Fluency with the industry's dominant web imaging engine — a React frontend
   built on **Cornerstone3D** (the engine behind OHIF) using its volume
   pipeline: multiplanar reconstruction (MPR) with synchronized crosshairs
   and GPU direct volume rendering.

The viewer opens a CT/MR series as a **volume**, never as a flat image stack.
The four-panel layout (axial, sagittal, coronal, 3D) is the product.

**v1 is brain-focused.** The bundled sample data, the VOI/volume-rendering
presets, and the demo flow all center on brain MR. The backend itself stays
modality-agnostic (it validates and serves any regular 3D DICOM grid); only
the *sample selection and presets* are scoped to brain for this v1.

## 2. Scope

### In scope (v1)

- Bundled public anonymized volumetric sample studies (2, both brain MR),
  fetched by a script.
- Drag-and-drop upload of a DICOM folder or `.zip`.
- Backend volume validation: is this series a regular 3D grid, and if not, why.
- Study browser: study list → series grid with thumbnails; non-volume series
  are greyed out with the reason.
- Viewer: 2×2 layout — three orthographic MPR viewports (axial, sagittal,
  coronal) and one 3D volume-rendering viewport, all backed by one shared
  volume in GPU memory.
- MPR interactions: synchronized crosshairs, slice scroll per plane,
  window/level, zoom, pan, modality VOI presets, reset.
- 3D interactions: trackball rotate, zoom, pan, transfer-function presets
  (CT bone, CT soft tissue, MR default, MR T2 brain), reset.
- Corner overlays (plane label, slice i/N, W/L, zoom) and a metadata side
  panel (dimensions, spacing, orientation, modality).
- Server-side decoding of compressed transfer syntaxes at ingest.
- Tests: pytest (backend), vitest (frontend units), one Playwright smoke test.
- README with architecture diagram, screenshots/GIF, run instructions.

### Out of scope (v1)

- A standalone 2D stack viewer; non-volumetric series (single-frame X-ray,
  2–3-slice localizers, mixed-orientation series) are not viewable.
- Surface (mesh) rendering, segmentation, measurements/annotations, their
  persistence.
- Hanging protocols, user accounts, authentication, PHI handling beyond
  "samples are anonymized".
- Public hosting / Docker (runs locally; README carries screenshots).
- STOW-RS (upload uses a simple custom endpoint).
- Git initialisation is done by the user, not by the implementation plan.

## 3. Architecture overview

Two processes, one repository, no third service.

```
┌───────────────────────────────────┐      DICOMweb (HTTP/JSON + binary)         ┌──────────────────────────────┐
│  frontend/  (React + Vite)        │ ── QIDO-RS  /dicomweb/studies ...   ─────▶ │  backend/  (FastAPI, Python) │
│  Cornerstone3D core + tools       │ ── WADO-RS  .../metadata, .../frames/N ──▶ │  pydicom · numpy · SQLite    │
│  streaming volume loader (wadors) │ ── GET /api/series/{uid}/volume-info ────▶ │  ingest → validate → index   │
│  MPR ×3 + VOLUME_3D viewports     │ ── POST /api/upload (multi-file / zip) ──▶ │  → serve                     │
└───────────────────────────────────┘                                            └──────────────┬───────────────┘
                                                                                                │
                                                                            data/store/<StudyUID>/<SeriesUID>/<SOPUID>.dcm
                                                                            data/index.sqlite   (study/series/instance tables)
```

**Backend** ingests (validate → decode → file → index), then runs a
per-series **volume check** that decides whether the instances form a regular
3D grid. It serves reads via a DICOMweb subset. Compressed pixel data is
decoded **once at ingest** and stored as Explicit VR Little Endian so
`frames/{n}` is a byte slice, never a decode — this matters more than in a 2D
viewer because the volume loader pulls *every* frame of a series up front.

**Frontend** contains no DICOM parsing. Cornerstone3D's streaming image volume
loader is pointed at the backend's WADO-RS endpoints; the volume is built in
GPU memory once and shared by all four viewports. React components talk to
Cornerstone only through a small adapter layer.

### Repository layout

```
Medical_Project/
├── backend/          FastAPI app, pytest suite, pyproject.toml
├── frontend/         Vite + React + TypeScript, vitest, one Playwright smoke test
├── data/
│   ├── samples/      bundled studies (fetched by script, git-ignored)
│   └── store/        ingested/uploaded studies + index.sqlite (git-ignored)
├── scripts/          fetch_samples.py, dev.ps1, test.ps1
├── docs/superpowers/ specs and plans
└── README.md
```

## 4. Backend design

### 4.1 Package layout

```
backend/
├── app/
│   ├── main.py            FastAPI app factory; mounts routers; startup ingest of SAMPLES_DIR
│   ├── config.py          Settings from env: STORE_DIR, SAMPLES_DIR, DB_PATH, MAX_UPLOAD_MB, CORS_ORIGINS
│   ├── db.py              sqlite3 connection + schema creation (no ORM)
│   ├── models.py          dataclasses StudyRow, SeriesRow, InstanceRow, VolumeInfo
│   ├── geometry.py        sort_instances(rows); volume_info(sorted_rows) — the 3D math
│   ├── ingest/
│   │   ├── reader.py      read_dicom(path) -> Dataset | raises NotDicomError
│   │   ├── decode.py      to_uncompressed(ds) -> Dataset (Explicit VR LE)
│   │   ├── store.py       file_instance(ds, store_dir) -> Path
│   │   └── indexer.py     index_instance(conn, ds, path); finalize_series(conn, series_uid); ingest_directory(conn, dir) -> IngestSummary
│   ├── dicomweb/
│   │   ├── json_model.py  dataset_to_dicom_json(ds, *, include_bulk=False) -> dict
│   │   ├── qido.py        router: studies / series / instances search
│   │   └── wado.py        router: metadata / frames / instance / rendered
│   └── api/
│       ├── volume.py      router: GET /api/series/{series_uid}/volume-info
│       ├── upload.py      router: POST /api/upload
│       └── health.py      router: GET /api/health
├── tests/
│   ├── conftest.py        make_ct_series(...) synthetic DICOM fixtures, TestClient app fixture
│   └── test_*.py
└── pyproject.toml         fastapi, uvicorn, pydicom>=3, pylibjpeg[all], numpy, python-multipart, pillow
```

### 4.2 Ingestion pipeline

Stages are pure functions called in order by `ingest_directory` and by
`/api/upload`:

1. **`reader.read_dicom(path)`** — `pydicom.dcmread(path, force=False)`.
   Raises `NotDicomError` when the file is not DICOM or lacks
   `SOPInstanceUID`, `SeriesInstanceUID`, `StudyInstanceUID`, or `PixelData`.
   Non-image objects (SR, PR, KO, …) are skipped, counted in the summary, and
   never abort a batch.
2. **`decode.to_uncompressed(ds)`** — if
   `ds.file_meta.TransferSyntaxUID.is_compressed`, call `ds.decompress()` and
   set the transfer syntax to `ExplicitVRLittleEndian`. Uncompressed input
   passes through unchanged. Decode failure raises `DecodeError` and the
   instance is skipped with that reason.
3. **`store.file_instance(ds, store_dir)`** — writes
   `store_dir/<StudyUID>/<SeriesUID>/<SOPUID>.dcm`. Re-ingesting the same SOP
   instance overwrites idempotently.
4. **`indexer.index_instance(conn, ds, path)`** — `INSERT OR REPLACE` into
   the three tables below.
5. **`indexer.finalize_series(conn, series_uid)`** — after all files of a
   batch are indexed: loads the series' instance rows, runs
   `geometry.sort_instances` then `geometry.volume_info`, and writes
   `instance_count`, `thumb_sop_uid` (middle slice), `sort_method`,
   `is_volume`, `volume_reason`, `dims`, `spacing` onto the series row.

`ingest_directory` walks recursively, applies stages 1–4 per file, stage 5
per touched series, and returns
`IngestSummary { accepted: int, skipped: list[{file, reason}], study_uids: list[str] }`.

### 4.3 Index schema (SQLite)

```
study    (study_uid TEXT PK, patient_name, patient_id, study_date, study_desc,
          accession, modalities TEXT)          -- modalities: comma-joined distinct
series   (series_uid TEXT PK, study_uid FK, modality, series_desc, series_number INT,
          instance_count INT, thumb_sop_uid TEXT, sort_method TEXT,
          is_volume INT, volume_reason TEXT,
          dim_x INT, dim_y INT, dim_z INT, spacing_x REAL, spacing_y REAL, spacing_z REAL)
instance (sop_uid TEXT PK, series_uid FK, instance_number INT, rows INT, cols INT,
          bits_allocated INT, pixel_representation INT, num_frames INT,
          ipp_x REAL, ipp_y REAL, ipp_z REAL, iop TEXT, pixel_spacing TEXT,
          path TEXT, transfer_syntax TEXT)
```

Only tags needed for browsing, sorting, and volume validation are indexed.
Full headers are read from disk when `metadata` is requested.

### 4.4 Slice ordering and volume validation (`geometry.py`)

**`sort_instances(rows) -> (sorted_rows, method)`**

```
normal = cross(iop[0:3], iop[3:6])
key    = dot(ipp, normal)
```

Sort ascending by `key`. If any instance lacks IPP/IOP, or orientations
differ across the series, fall back to `InstanceNumber`, then to filename.
`method` is `"geometry" | "instance-number" | "filename"`.

**`volume_info(sorted_rows) -> VolumeInfo`**

```
VolumeInfo { is_volume: bool, reason: str | None,
             dims: (x, y, z) | None, spacing: (x, y, z) | None,
             origin: (x, y, z) | None, direction: 9 floats | None }
```

`is_volume` is true only when all of the following hold (each failure sets a
human-readable `reason`, first failure wins):

| Check | Reason string when it fails |
|---|---|
| `method == "geometry"` | `"missing or inconsistent orientation"` |
| ≥ 3 instances (after multi-frame expansion) | `"fewer than 3 slices"` |
| all `rows`, `cols`, `bits_allocated`, `pixel_representation`, `pixel_spacing` identical | `"inconsistent image dimensions"` |
| consecutive `key` gaps all within 1 % of the median gap (tolerance also catches duplicates, gap = 0) | `"irregular slice spacing"` |

Mixed orientations never reach a dedicated check here: `sort_instances` only
returns `method == "geometry"` when all IOP vectors already agree within
1e-4, so a series with inconsistent orientations surfaces as
`"missing or inconsistent orientation"` (the first check above) instead.

`spacing_z` is the median gap (not `SliceThickness`, which is unreliable);
`origin` is the first sorted instance's IPP; `direction` is
`[row_cosines, col_cosines, normal]`.

### 4.5 DICOMweb surface

Content type for JSON responses is `application/dicom+json`.

| Method + path | Returns |
|---|---|
| `GET /dicomweb/studies?PatientName=&PatientID=&StudyDate=&limit=&offset=` | Array of study objects with QIDO-required tags (0008,0020 StudyDate; 0008,0030; 0008,0050; 0008,0061 ModalitiesInStudy; 0010,0010; 0010,0020; 0020,000D; 0008,1030; 0020,1206; 0020,1208) |
| `GET /dicomweb/studies/{study}/series` | Array of series objects (0008,0060 Modality; 0008,103E; 0020,000E; 0020,0011; 0020,1209 NumberOfSeriesRelatedInstances) |
| `GET /dicomweb/studies/{study}/series/{series}/instances` | Array of instance objects (0008,0018; 0020,0013; 0028,0008; 0028,0010; 0028,0011) |
| `GET /dicomweb/studies/{study}/series/{series}/metadata` | Array of full-header JSON per instance, `PixelData` omitted, **ordered by `sort_instances`**; header `X-Sort-Method` |
| `GET /dicomweb/studies/{study}/series/{series}/instances/{sop}/frames/{n}` | `multipart/related; type="application/octet-stream"` with raw bytes of frame `n` (1-based). Sets `Cache-Control: public, max-age=86400` and `Content-Length` so the volume loader can show progress. |
| `GET /dicomweb/studies/{study}/series/{series}/instances/{sop}` | `multipart/related; type="application/dicom"` containing the stored file |
| `GET /dicomweb/studies/{study}/series/{series}/instances/{sop}/rendered?viewport=128,128` | `image/png` thumbnail using the instance's default window (or min/max) |

`metadata` rewrites `(0002,0010) TransferSyntaxUID` to `1.2.840.10008.1.2.1`
because the stored file is always uncompressed.

### 4.6 Volume info endpoint (custom, non-DICOMweb)

`GET /api/series/{series_uid}/volume-info` → `200`

```json
{ "seriesUid": "...", "isVolume": true, "reason": null,
  "dims": [512, 512, 300], "spacing": [0.7, 0.7, 1.0],
  "origin": [-180.0, -180.0, -120.0],
  "direction": [1,0,0, 0,1,0, 0,0,1],
  "modality": "CT", "sortMethod": "geometry", "instanceCount": 300,
  "estimatedBytes": 157286400 }
```

`estimatedBytes = dims.x × dims.y × dims.z × bytesPerVoxel`; the frontend uses
it to show a progress bar and to warn above 1 GB. The series grid calls this
endpoint per series (cheap at portfolio scale) rather than smuggling the data
into the QIDO response via private tags.

### 4.7 DICOM JSON model rules (`json_model.py`)

- Keys are 8-hex-digit uppercase tags; each value is `{"vr": ..., "Value": [...]}`.
- `PN` values emit `{"Alphabetic": "..."}`.
- Empty elements emit `{"vr": "XX"}` with no `Value`.
- `OB`, `OW`, `OF`, `OD`, `UN` are omitted when `include_bulk=False`.
- `FL`, `FD`, `DS` emit JSON numbers; `IS`, `SL`, `SS`, `UL`, `US` emit integers.
- Sequences (`SQ`) recurse.
- Cross-checked in tests against `pydicom.Dataset.to_json_dict()`.

### 4.8 Upload (`POST /api/upload`)

- Accepts `multipart/form-data` with one or more `files` parts. Each part is
  either a DICOM file or a `.zip`.
- Zips are extracted to a temp dir; entries containing `..` or absolute paths
  → `400`.
- Total request size > `MAX_UPLOAD_MB` (default 500) → `413`.
- Runs the ingest pipeline (including `finalize_series`); responds `200` with
  `IngestSummary` as JSON even when some files were skipped.

### 4.9 Error semantics

| Situation | Response |
|---|---|
| Unknown study/series/SOP UID | `404`, body `{"detail": "..."}` |
| Frame index out of range | `404` |
| Non-DICOM file in upload | listed in `skipped`, status `200` |
| Series with zero decodable instances | not indexed; each file appears in `skipped` |
| Decode failure on exotic transfer syntax | instance skipped with reason; series still indexed if ≥1 survives |
| Series indexed but `is_volume=false` | still listed by QIDO and `volume-info`; `reason` explains why it cannot be opened |

## 5. Frontend design

### 5.1 Package layout

```
frontend/src/
├── main.tsx                     calls initCornerstone() then mounts <App/>
├── App.tsx                      routes: "/" (browser), "/viewer/:studyUid/:seriesUid"
├── api/
│   ├── client.ts                fetch wrapper; base URL from VITE_API_URL
│   ├── dicomweb.ts              getStudies(), getSeries(studyUid), getSeriesMetadata(studyUid, seriesUid), thumbnailUrl(...)
│   ├── volume.ts                getVolumeInfo(seriesUid) -> VolumeInfo
│   ├── upload.ts                uploadFiles(files: File[]) -> Promise<UploadSummary>
│   └── types.ts                 Study, Series, InstanceMeta, VolumeInfo, UploadSummary
├── cornerstone/
│   ├── init.ts                  initCornerstone(): init core, tools, dicom-image-loader; register wadors; detect WebGL2
│   ├── imageIds.ts              buildImageIds(baseUrl, studyUid, seriesUid, instances) -> string[]; seedMetadata(imageIds, instances)
│   ├── volume.ts                loadVolume(volumeId, imageIds, onProgress) -> Promise<IImageVolume>; releaseVolume(volumeId)
│   ├── viewports.ts             createViewerLayout(engine, elements) -> ViewportIds  (3 ORTHOGRAPHIC + 1 VOLUME_3D)
│   ├── toolGroups.ts            createMprToolGroup(id), createVolume3dToolGroup(id), destroyToolGroups()
│   └── presets.ts               VOI_PRESETS (MPR window/level) and VOLUME_PRESETS (3D transfer functions) by modality
├── components/
│   ├── browser/  StudyList.tsx, SeriesGrid.tsx (greyed non-volume cards with reason), UploadDropzone.tsx
│   ├── viewer/   ViewerLayout.tsx (2×2 grid), MprViewport.tsx, Volume3dViewport.tsx, Toolbar.tsx,
│   │             ViewportOverlay.tsx, MetadataPanel.tsx, LoadProgress.tsx
│   └── ui/       Button.tsx, Spinner.tsx, ErrorBanner.tsx
├── hooks/
│   ├── useSeriesMetadata.ts     TanStack Query over WADO metadata -> { instances, sortMethod }
│   ├── useVolume.ts             orchestrates volume-info → metadata → loadVolume; exposes { status, progress, volume, error }
│   └── useViewportState.ts      Cornerstone events -> per-viewport { sliceIndex, numSlices, voi, zoom }
└── styles/                      Tailwind, dark radiology theme
```

### 5.2 Layout and tool bindings

2×2 grid. Top-left axial, top-right sagittal, bottom-left coronal,
bottom-right 3D. Any panel can be maximised by double-click.

**MPR tool group** (attached to the three orthographic viewports):

| Tool | Binding |
|---|---|
| Crosshairs (synchronized across the 3 planes) | left-drag on the crosshair handles; toggle in toolbar |
| WindowLevel | left-drag (when Crosshairs is inactive) |
| Pan | middle-drag (and Shift+left) |
| Zoom | right-drag (and Ctrl+left) |
| StackScroll (through the volume along the plane normal) | mouse wheel, ↑/↓ keys |

**3D tool group** (attached to the `VOLUME_3D` viewport):

| Tool | Binding |
|---|---|
| TrackballRotate | left-drag |
| Pan | middle-drag |
| Zoom | right-drag / wheel |

**Toolbar:** crosshairs on/off, VOI preset dropdown for MPR (CT: brain
40/80, bone 400/1800, soft tissue 50/400; MR: from header),
3D preset dropdown (Cornerstone `VIEWPORT_PRESETS`: CT-Bone,
CT-Soft-Tissue, MR-Default, MR-T2-Brain), invert (MPR), reset all.

### 5.3 Data flow — opening a series

1. Route `/viewer/:study/:series` → `useVolume` first calls
   `getVolumeInfo(series)`. If `isVolume` is false it renders a
   "Cannot open: {reason}" page with a back link and stops.
2. It then fetches `…/metadata`. Instances arrive sorted; `buildImageIds`
   produces `wadors:<api>/dicomweb/…/frames/<f>` ids (one per frame) and
   `seedMetadata` registers each instance's header with the wadors metadata
   manager so the loader has image-plane, pixel, VOI, and modality LUT modules
   without extra requests.
3. `loadVolume` calls
   `volumeLoader.createAndCacheVolume('cornerstoneStreamingImageVolume:' + seriesUid, { imageIds })`
   and `volume.load(onProgress)`. `LoadProgress` shows frames loaded / total
   and the `estimatedBytes` figure from step 1.
4. `ViewerLayout` mounts four `<div>`s; `createViewerLayout` calls
   `renderingEngine.setViewports([...])` with three `ORTHOGRAPHIC` viewports
   (orientations `AXIAL`, `SAGITTAL`, `CORONAL`) and one `VOLUME_3D`
   viewport, then `setVolumesForViewports(engine, [{ volumeId }], allFourIds)`.
   Each MPR viewport starts at the middle slice; the 3D viewport applies the
   default preset for the modality and `resetCamera()`.
5. Tool groups are created once per viewer mount and attached; Crosshairs is
   configured with the three MPR viewport ids so a drag in one plane moves the
   other two.
6. `useViewportState` subscribes to `IMAGE_RENDERED`, `VOLUME_NEW_IMAGE`,
   `VOI_MODIFIED`, `CAMERA_MODIFIED` per viewport and drives the overlays.
7. Presets: MPR → `viewport.setProperties({ voiRange })` on each MPR
   viewport; 3D → `viewport.setProperties({ preset })`. Reset → `resetCamera()`
   + `resetProperties()` on all four and re-centre crosshairs.
8. On unmount: `destroyToolGroups()`, `renderingEngine.disableElement` for
   all four, `releaseVolume(volumeId)` (removes from `cache`), so opening a
   second series does not double GPU memory. Covered by the Playwright test
   (open → back → open another → back → reopen the first).

### 5.4 Study browser

`StudyList` (QIDO studies) → `SeriesGrid` (QIDO series + `volume-info` per
series; `<img>` thumbnails from `rendered`). Volume series are clickable and
show `dims` and `spacing`; non-volume series are greyed with the `reason`
badge and are not links. `UploadDropzone` accepts a dropped folder
(`webkitdirectory`) or `.zip`, posts to `/api/upload`, invalidates the studies
query, and shows the `accepted` count and each `skipped` reason inline.

### 5.5 Frontend error handling

| Situation | Behaviour |
|---|---|
| Backend unreachable | `ErrorBanner` with retry on the browser; viewer redirects to `/` with a message |
| `isVolume=false` | Viewer shows "Cannot open: {reason}" with a back link; never attempts to load |
| `estimatedBytes` > 1 GB | Confirmation dialog before loading ("This volume needs ~N GB of GPU memory") |
| A frame fails during volume load | Loader retries once; if it still fails the load is aborted with "slice N failed" and the cached partial volume is released |
| WebGL2 unavailable | `initCornerstone()` rejects → full-page "WebGL2 required" message |
| Upload 400/413 | Dropzone shows the `detail` message |

## 6. Testing strategy

No test depends on network or the sample downloads.

### Backend (pytest)

- `conftest.make_ct_series(n, spacing, orientation, transfer_syntax, *, irregular=False, mixed_orientation=False)`
  builds synthetic DICOM datasets in memory with pydicom.
- `test_geometry.py`: sorting — axial, coronal, oblique, shuffled input,
  missing IPP → instance-number fallback, mixed orientation → fallback;
  volume_info — regular series is a volume with correct dims/spacing/origin/
  direction, each failing check yields its exact `reason` string, duplicate
  slice → irregular spacing, spacing derived from the median gap not
  `SliceThickness`.
- `test_json_model.py`: PN encoding, empty values, bulk omission, numeric
  typing, sequences, cross-check vs `to_json_dict()`.
- `test_decode.py`: JPEG 2000 and RLE fixtures round-trip to Explicit VR LE
  with `np.array_equal(pixel_array)`.
- `test_ingest.py`: idempotent re-ingest, non-DICOM skipped with reason,
  multi-frame instance count, SR object skipped, `finalize_series` writes
  `is_volume` and dims.
- `test_qido.py`, `test_wado.py`, `test_volume.py`, `test_upload.py`
  (FastAPI `TestClient`): status codes, content types, multipart framing,
  `frames/{n}` byte length = `Rows × Cols × BytesPerSample × SamplesPerPixel`,
  `Content-Length` and cache headers present, `metadata` ordering and
  `X-Sort-Method`, `volume-info` JSON shape for a volume and a non-volume,
  unknown UID → 404, zip with `../` → 400, size → 413.

### Frontend

- **vitest** (jsdom): `imageIds.ts` single/multi-frame, `presets.ts`,
  `api/*` DICOM-JSON → flat mappers, `SeriesGrid` renders greyed card with
  reason for `isVolume=false`, `UploadDropzone` summary rendering with
  MSW-mocked responses, `useVolume` state machine (info → metadata → loading
  → ready / error) with mocked loader, `useViewportState` reducer.
- **Playwright** (one smoke test, headless Chromium with software WebGL,
  `--use-gl=angle --use-angle=swiftshader`): backend started with a synthetic
  40-slice 64×64 CT series → open `/` → click series → wait for
  `LoadProgress` to finish → all four canvases are non-black → wheel scroll on
  the axial panel changes its overlay slice index → drag the crosshair in
  axial changes the sagittal/coronal slice indices → click "Bone" preset →
  overlay W/L changes → navigate back → open again → still renders. The 3D
  panel is asserted non-black only (software rendering is too slow to assert
  more).

## 7. Sample data

`scripts/fetch_samples.py` downloads into `data/samples/` and verifies each
series against a committed manifest (`scripts/samples.json`) that pins the
source, `SeriesInstanceUID`, expected instance count, and license. (TCIA
serves streamed zips whose bytes are not stable across downloads, so the
manifest pins UIDs and counts rather than zip checksums; after extraction the
script re-reads every file with pydicom and fails loudly on a mismatch.)
Every sample must pass `volume_info` (≥ 3 slices, regular spacing):

v1 is brain-only: both samples are brain MR from the same UPENN-GBM patient
(`UPENN-GBM-00041`), one compressed and one uncompressed so both the
transcoded-decode and plain-decode ingest paths are exercised on real data.
There is no CT brain series in TCIA's brain collections, so no CT sample is
bundled in v1 — the backend itself remains modality-agnostic and a CT sample
can be reintroduced later without code changes.

- **MR brain (T1 MPRAGE)** — TCIA UPENN-GBM, subject `UPENN-GBM-00041`,
  series `1.3.6.1.4.1.14519.5.2.1.238667833945377278535172479340077807244`,
  160 slices, ~16 MB, CC BY 4.0. The fetch script **transcodes this series to
  JPEG 2000 Lossless** (`Dataset.compress`) before saving, verifying pixel
  equality, so the ingest decode path is exercised on real data.
- **MR brain (T2-FLAIR)** — TCIA UPENN-GBM, subject `UPENN-GBM-00041`,
  series `1.3.6.1.4.1.14519.5.2.1.24745356049796355440510272164766429919`,
  60 slices, ~6 MB, CC BY 4.0. Stored uncompressed, covering the plain-decode
  ingest path.

Both are fetched via TCIA's public REST endpoint
`https://services.cancerimagingarchive.net/nbia-api/services/v1/getImage?SeriesInstanceUID=<uid>`
(returns a zip; no authentication for these collections). No binary sample
data is committed; the README credits the UPENN-GBM collection as its
license requires.

## 8. Tooling and conventions

- **Backend:** Python 3.12, `uv` for deps, `ruff` (lint+format), `mypy` on
  `app/`, `pytest`.
- **Frontend:** Node 24, Vite, TypeScript strict, ESLint, Prettier, Tailwind,
  TanStack Query, react-router, `@cornerstonejs/core` (≥ 2.x, which bundles
  the streaming volume loader), `@cornerstonejs/tools`,
  `@cornerstonejs/dicom-image-loader`, vitest, MSW, Playwright.
- **Scripts (PowerShell, Windows-first):** `scripts/dev.ps1` runs uvicorn
  (`--reload`) and Vite together; `scripts/test.ps1` runs pytest + vitest.
- **Config:** `.env.example` at root; backend reads `STORE_DIR`, `SAMPLES_DIR`,
  `DB_PATH`, `MAX_UPLOAD_MB`, `CORS_ORIGINS`; frontend reads `VITE_API_URL`.
  CORS restricted to the Vite origin.
- **Hardware note:** development target is a GTX 1650 (4 GB VRAM); the
  bundled samples are chosen to stay well under 512 MB per volume.
- **README:** what it is, architecture diagram, screenshots/GIF of the 2×2
  layout and a rotating 3D bone render, three-command run, "DICOM standards
  implemented" section, roadmap (see §9).
- **Git:** initialised by the user; the plan does not run `git init`.

## 9. Extension seam (not in v1)

The backend already serves everything Cornerstone needs for its next
features, so these are frontend-only additions:

- **Measurements / annotations** — Cornerstone `Length`, `Angle`, `Probe`
  tools on the MPR viewports; persistence would add a small backend table.
- **Segmentation** — Cornerstone labelmap segmentation on the same volume;
  brush/threshold tools.
- **Surface rendering** — a `POST /api/series/{uid}/mesh?threshold=` endpoint
  running marching cubes (scikit-image) and a mesh viewport; this is the one
  item that needs backend work.

## 10. Definition of done (v1)

- All backend and frontend tests pass via `scripts/test.ps1`.
- All bundled sample series (§7) open into the 2×2 layout; MPR scroll and
  crosshair drag are smooth; the 3D panel rotates interactively on the GTX 1650.
- A dragged folder of DICOM files appears in the study browser within
  seconds, with skipped files and non-volume series explained.
- README screenshots/GIF are real captures of the running app.
