# Technical Requirements — DICOM 3D Brain Viewer

Status: **implemented and verified**, 2026-09-23. Every requirement below is
traced to the code that satisfies it and the test that proves it.

## 1. Scope

Browser-based 3D viewer for brain MR studies. Local single-user deployment.

**In:** DICOMweb backend over a local file store; study/series browsing;
drag-and-drop upload of files, folders or `.zip`; 2×2 viewer (axial / sagittal /
coronal MPR with synchronised crosshairs + GPU volume rendering); brain-oriented
window and transfer-function presets.

Measurements on the MPR planes (length, angle, probe, elliptical ROI, and
bidirectional long/short axis), persisted as a DICOM Structured Report stored
beside the images.

Hand-painted segmentation on the MPR planes, several labelled segments per
series, persisted as a BINARY DICOM Segmentation object stored beside the
images.

**Out:** surface rendering of a segment, automatic or model-driven
segmentation, reading a third-party Segmentation object, hanging protocols,
authentication, multi-user, hosting, STOW-RS, PHI handling beyond "samples are
anonymised".

## 2. Platform

| | |
|---|---|
| Backend | Python 3.12 · FastAPI 0.141 · pydicom 3 · numpy 2 · SQLite (stdlib) · uvicorn on **:8001** (factory mode) |
| Frontend | Node 24 · React 19 · Vite 8 · TypeScript 6 (strict) · Tailwind 4 · Cornerstone3D 5.10 · TanStack Query 5 · react-router 8 |
| Test | pytest · ruff · mypy --strict · vitest + MSW · Playwright |
| Browser | WebGL2 required; detected at startup with an explicit fallback page |

## 3. Functional requirements

| # | Requirement | Implementation | Verified by |
|---|---|---|---|
| F1 | Ingest a DICOM file, reject non-DICOM and non-image objects with a per-file reason | `ingest/reader.py` | `test_reader.py`, `test_indexer.py` |
| F2 | Reject syntactically invalid SOP/Series/Study UIDs before they reach the filesystem | `ingest/reader.py` + `store._ensure_within` | `test_reader.py`, `test_store.py` |
| F3 | Decode JPEG 2000 / JPEG-LS / RLE once at ingest to Explicit VR LE, preserving SOP Instance UID | `ingest/decode.py` | `test_decode.py` |
| F4 | Order slices anatomically by `dot(ImagePositionPatient, normal)`; fall back to InstanceNumber then filename | `geometry.sort_instances` | `test_geometry.py` |
| F5 | Classify a series as a volume only if geometry-sorted, ≥ 3 slices, consistent dimensions, single orientation, uniform spacing — with a reason on failure | `geometry.volume_info` | `test_geometry.py` (one case per reason) |
| F6 | Serve QIDO-RS study/series/instance search with filters and paging | `dicomweb/qido.py` | `test_qido.py` |
| F7 | Serve WADO-RS `metadata` (sorted, `X-Sort-Method`), `frames/{n}` as `multipart/related`, instance retrieval, `rendered` PNG | `dicomweb/wado.py` | `test_wado.py` |
| F8 | Emit DICOM JSON per PS3.18 Annex F (PN components, empty elements, bulk omission, numeric typing, sequences) | `dicomweb/json_model.py` | `test_json_model.py` (cross-checked against pydicom) |
| F9 | Expose volume geometry for the client: dims, spacing, origin, direction, estimated bytes | `api/volume.py` | `test_volume_api.py` |
| F10 | Accept multi-file and `.zip` upload; partial success; reject path traversal and zip bombs | `api/upload.py` | `test_upload.py` |
| F11 | Browse studies → series with thumbnails; non-volume series greyed with reason | `components/browser/*` | `SeriesGrid.test.tsx` |
| F12 | Upload by drag-and-drop of files, a folder, or a `.zip` | `UploadDropzone.tsx` | `UploadDropzone.test.tsx` |
| F13 | Open a volume into 3 MPR viewports + 1 3D viewport sharing one GPU volume | `cornerstone/viewports.ts`, `ViewerLayout.tsx` | e2e + manual |
| F14 | Synchronised crosshairs; per-plane scroll; window/level; zoom; pan; presets; reset | `cornerstone/toolGroups.ts`, `Toolbar.tsx` | e2e, `Toolbar.test.tsx` |
| F15 | Report load progress; refuse non-volume series; confirm above 1 GB | `hooks/useVolume.ts` | `useVolume.test.tsx` |
| F16 | Measure length, angle, probe, elliptical ROI and bidirectional (RECIST long/short axis) on the MPR planes, in real units | `cornerstone/annotations.ts`, `toolGroups.ts` | `annotations.test.ts`, e2e |
| F17 | Store a measurement set as a Comprehensive 3D SR in its own series, round-tripped on reopen | `app/sr/*`, `api/measurements.py` | `test_sr_build_parse.py`, `test_measurements_api.py`, e2e |
| F18 | Compute length and angle from the stored coordinates, so the report is self-consistent | `app/sr/validate.py` | `test_sr_validate.py`, `test_measurements_api.py` |
| F19 | Hold non-image DICOM instances in the store without breaking image paths | `ingest/reader.py`, `ingest/indexer.py` | `test_non_image_instances.py` |
| F20 | Paint and erase segments on the MPR planes with a brush, several labelled segments per series, segment 0 erasing | `cornerstone/segmentation.ts`, `hooks/useSegmentation.ts`, `Toolbar.tsx` | `segmentation.test.ts`, `useSegmentation.test.tsx`, `Toolbar.test.tsx`, e2e |
| F21 | Store a painted mask as a BINARY Segmentation in its own series, round-tripped on reopen, saved independently of the report | `app/segmentation/*`, `api/segmentations.py` | `test_seg_build_parse.py`, `test_segmentations_api.py`, e2e |
| F22 | Carry the label volume between client and store as raw bytes in the volume's own index order, one uint8 per voxel | `app/segmentation/mask.py`, `api/segmentation.ts` | `test_seg_mask.py`, `test_segmentations_api.py` |

## 4. Non-functional requirements

| # | Requirement | How it is met |
|---|---|---|
| N1 | A failed frame must never be presented as valid image data | `loadVolume` rejects on the first `IMAGE_LOAD_ERROR`, releases the partial volume, names the slice |
| N2 | Concurrent frame requests must not corrupt the index | Connection per request (`get_db`), WAL, `busy_timeout`; a shared connection raised `InterfaceError` under load |
| N3 | Uploads must not escape the store | UID syntax validation, `_ensure_within` containment on both file writes and zip entries |
| N4 | Uploads must not exhaust disk or memory | Chunked streaming read with an early `413`; decompressed-byte budget shared with the raw request limit |
| N5 | Opening, leaving and reopening series must not leak | Abort in-flight load, destroy tool groups, disable viewports, release the volume; latch keyed to `seriesUid` |
| N6 | Frame retrieval must not decode | Guaranteed by F3; `frames/{n}` is a byte slice with `Content-Length` and cache headers |
| N7 | Type and lint discipline | `mypy --strict` on `app/`, TypeScript `strict`, ruff, oxlint, Prettier — all clean |
| N8 | Test output must be pristine | Zero warnings in both suites; third-party deprecations filtered by exact match, never blanket |
| N9 | A report that cannot be read must never stop the series opening | `GET` returns an empty set with `parseError`; the viewer shows a non-blocking notice |
| N10 | A concurrent save must not silently overwrite another client's work | Optimistic `srSopUid` check, 409 on mismatch |
| N11 | A half-finished save must not lose the only copy | Write the new report and index it before deleting the previous one; the newest instance wins on read. The same ordering, and the same newest-wins read, protect the segmentation |
| N12 | A segmentation that cannot be read must never stop the series opening | `GET` returns no segments with `parseError`; `labelmap` answers 404; the viewer shows a non-blocking notice, and painting replaces the unreadable object |
| N13 | A mask must never be silently misaligned with its images | The wire bytes are a reshape of the volume's own index order, never a transpose; the byte count is checked against the series' dims on both sides; the SEG's frames are mapped back by source SOP Instance UID, and a missing frame must be provably empty |
| N14 | Clearing every voxel must remove the object, not store an empty one | An all-zero labelmap deletes the stored Segmentation and its series instead of writing a SEG with no segments |

## 5. Interfaces

```
GET  /api/health                                   → {"status":"ok"}
GET  /api/series/{series_uid}/volume-info          → {seriesUid,isVolume,reason,dims,spacing,origin,
                                                      direction,modality,sortMethod,instanceCount,estimatedBytes}
GET  /api/series/{series_uid}/measurements         → {seriesUid,frameOfReferenceUid,srSeriesUid,
                                                      srSopUid,parseError,measurements[]}
PUT  /api/series/{series_uid}/measurements         → same envelope, with the new srSopUid
GET  /api/series/{series_uid}/segmentation         → {seriesUid,frameOfReferenceUid,dims,segSeriesUid,
                                                      segSopUid,parseError,segments[]}
PUT  /api/series/{series_uid}/segmentation         (multipart: `meta` JSON + `labelmap` octet-stream)
                                                   → same envelope, with the new segSopUid
GET  /api/series/{series_uid}/segmentation/labelmap → application/octet-stream, nx*ny*nz uint8
POST /api/upload            (multipart, field `files`, repeated)
                                                   → {accepted,skipped:[{file,reason}],studyUids}
GET  /dicomweb/studies[?PatientName&PatientID&StudyDate&limit&offset]      → application/dicom+json
GET  /dicomweb/studies/{study}/series                                      → application/dicom+json
GET  /dicomweb/studies/{study}/series/{series}/instances                   → application/dicom+json
GET  /dicomweb/studies/{study}/series/{series}/metadata                    → application/dicom+json, X-Sort-Method
GET  /dicomweb/studies/{study}/series/{series}/instances/{sop}             → multipart/related; type="application/dicom"
GET  /dicomweb/studies/{study}/series/{series}/instances/{sop}/frames/{n}  → multipart/related; type="application/octet-stream"
GET  /dicomweb/studies/{study}/series/{series}/instances/{sop}/rendered?viewport=W,H → image/png
```

Errors: `400` unsafe zip entry · `404` unknown UID, frame out of range, or no
stored segmentation · `409` the stored object moved under a concurrent save ·
`413` over the size budget · `422` malformed query parameter, malformed
segment, a labelmap whose length disagrees with the series' dims, a voxel value
no segment declares, or a series that is not a volume. Bodies are `{detail}`.

**Storage:** `data/store/<StudyUID>/<SeriesUID>/<SOPUID>.dcm` plus
`data/store/index.sqlite` (`study` · `series` · `instance`). Both git-ignored.

## 6. Verification

`scripts/test.ps1` → **151 backend tests** (pytest) + 3 script tests + ruff +
mypy + **72 frontend tests** (vitest), exit 0, no warnings.
`cd frontend; npm run e2e` → **3 Playwright tests**: the first seeds a
synthetic 40-slice series, opens it, and asserts four non-blank canvases,
scroll, crosshair sync, preset change and reopen; the second paints with the
brush, saves, reloads the page, and asserts the labelmap comes back out of the
store with a non-zero voxel count; the third draws a length, saves it, reloads,
and asserts the report comes back over WADO-RS. No network, no sample data.

**Sample data:** two brain MR series from TCIA UPENN-GBM patient
`UPENN-GBM-00041` — T1 MPRAGE (160 slices, transcoded to JPEG 2000 Lossless so
the decode path runs on real data) and T2-FLAIR (60 slices, uncompressed).
CC BY 4.0, fetched and verified by `scripts/fetch_samples.py` against
`scripts/samples.json`. Nothing binary is committed.

## 7. Known limitations

- Multi-frame instances are indexed but never classified as volumes; per-frame
  spacing would have to come from the enhanced functional-group sequences.
- Cornerstone-facing code is unit-tested against a hand-written mock of
  Cornerstone; only the Playwright test observes real library event shapes.
- No cancellation of the info/metadata HTTP requests — React Query drops the
  response but the request completes.
- `npm audit` reports transitive advisories under `@cornerstonejs` → vtk.js with
  no non-breaking upstream fix; the app is local-only.
- The view plane a measurement was drawn on has no slot in TID 1500, so it is
  written as extra numeric content items under a private coding scheme
  (`99DICOMVIEWER`). A foreign reader ignores them and still reads the
  measurement correctly; ours needs them, because a two-point length cannot
  have its plane inferred from two points.
- Only reports this application wrote are parsed. A third-party SR is reported
  as unreadable rather than partially interpreted.
- Length and angle are recomputed from the SCOORD3D coordinates rather than
  taken from the client, so the number and the geometry beside it always
  agree. Cornerstone measures length in index space with a calibration scale,
  so its on-screen figure can differ from the patient-space millimetres the
  report records on an anisotropic or calibrated volume. The report's value is
  the more defensible of the two, but they are not guaranteed identical.
- Probe and ROI statistics are recorded on the client's word, because
  verifying them needs pixel access this layer deliberately does not take.
- A restored measurement carries geometry only. Cornerstone recomputes its
  numbers against the loaded volume, so a value shown after a reload is
  derived afresh rather than replayed from the report.
- Segmentations are BINARY only. A FRACTIONAL or LABELMAP object, and any
  Segmentation this application did not write, is reported as unreadable rather
  than partially interpreted — the same rule the report follows.
- A segment has no surface. The mask is drawn as a labelmap overlay on the
  three MPR planes and nothing is added to the 3D viewport, where a labelmap
  would render nothing useful.
- The brush paints in world space, so a single stroke can touch neighbouring
  slices rather than only the plane under the cursor. That is Cornerstone's
  own behaviour and it is what a radiologist painting a volume expects, but it
  means the mask is not editable slice-by-slice in the strict sense.
- Segment category and type are fixed to a small coded vocabulary
  (Morphologically Abnormal Structure, with Neoplasm or Neoplasm Primary); the
  backend rejects a code it cannot map rather than writing an uncoded segment.
- Writing a Segmentation reads every source instance's header to satisfy
  highdicom's patient and study attribute requirements, so a save costs one
  header read per slice. On the 160-slice sample that is the dominant cost of
  the request.
- Time-to-first-paint grows with every viewer mounted in one browser process
  under the software rasteriser the e2e suite uses, because the GPU process
  reclaims a closed page's WebGL resources lazily. The suite budgets 90s per
  panel for it; on real hardware it is immediate.
