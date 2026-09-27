# Architecture — DICOM 3D Brain Viewer

Two processes, one repository, no third service. The browser does the rendering;
Python does everything that requires understanding DICOM.

```
┌──────────────────────────────────────┐                                 ┌─────────────────────────────────────┐
│  frontend/   React 19 + Vite + TS    │   DICOMweb (JSON + binary)      │  backend/   FastAPI + pydicom       │
│                                      │                                 │                                     │
│  components/  browser · viewer · ui  │ ── GET /dicomweb/studies ─────▶ │  dicomweb/  qido · wado             │
│  hooks/       useVolume · viewport   │ ── GET .../metadata ──────────▶ │             json_model · multipart  │
│                useMeasurements       │ ── GET .../frames/{n} ────────▶ │  api/       volume · upload · health│
│                useSegmentation       │ ── GET /api/series/{u}/         │             measurements · segs     │
│  cornerstone/ init · imageIds        │        volume-info ───────────▶ │  ───────────────────────────────    │
│               volume · viewports     │ ── GET|PUT .../measurements ──▶ │  ingest/    reader → decode →       │
│               toolGroups · presets   │ ── GET|PUT .../segmentation ──▶ │             store → indexer         │
│               annotations            │ ── GET .../segmentation/        │  geometry.py    sort + volume check │
│               segmentation           │        labelmap ──────────────▶ │  sr/           build · parse ·      │
│  api/         client · dicomweb      │ ── POST /api/upload ──────────▶ │                validate             │
│               volume · upload        │                                 │  segmentation/ mask · build ·       │
│               measurements · seg     │                                 │                parse · validate     │
│                                      │                                 │  repo.py        the only SQL        │
│  Cornerstone3D 5.10 · WebGL2         │                                 │  db.py          sqlite3, WAL        │
└──────────────────────────────────────┘                                 └──────────────────┬──────────────────┘
        :5173 (Vite dev)                                                        :8001       │
                                                                                            ▼
                                                        data/store/<StudyUID>/<SeriesUID>/<SOPUID>.dcm
                                                        data/store/index.sqlite   study · series · instance
```

## Backend — layers, innermost last

| Layer | Modules | Responsibility |
|---|---|---|
| HTTP | `dicomweb/qido.py`, `dicomweb/wado.py`, `api/*` | Routing, status codes, media types. No SQL, no pixel logic. |
| Serialisation | `dicomweb/json_model.py`, `dicomweb/multipart.py` | DICOM JSON model (PS3.18 F), `multipart/related` framing. |
| Ingest | `ingest/reader → decode → store → indexer` | Validate → decode to Explicit VR LE → file by UID → index → finalize. |
| Domain | `geometry.py`, `sr/`, `segmentation/` | Slice ordering, 3D-grid validation, Structured Report construction, parsing and validation, and the same three for Segmentation objects plus the label-volume codec. The only imaging maths. |
| Persistence | `repo.py`, `db.py`, `models.py` | Every SQL statement lives in `repo.py`. |

**Why decode at ingest, not on read.** The volume loader pulls every frame of a
series up front. Decoding JPEG 2000 once at ingest turns `frames/{n}` into a byte
slice of an already-uncompressed file, so frame retrieval never touches a codec.

**Connection per request.** `db.connect()` opens SQLite with WAL and
`busy_timeout`; the `get_db` dependency hands each request its own connection.
A single shared connection failed intermittently under the volume loader's
parallel frame fetches — `sqlite3.Connection` is not safe across threads.

## Frontend — layers, outermost first

| Layer | Modules | Responsibility |
|---|---|---|
| Routes | `App.tsx`, `BrowserPage`, `ViewerPage` | `/` and `/viewer/:studyUid/:seriesUid`. |
| Components | `components/browser/*`, `components/viewer/*` | DOM and React state only. |
| Hooks | `useVolume`, `useSeriesMetadata`, `useViewportState` | Orchestration: the load state machine, viewport event → React state. |
| Adapter | `cornerstone/*` | The only place that touches Cornerstone globals — including the annotation and segmentation state managers. |
| Transport | `api/*` | `fetch`, DICOM JSON → flat types. No DICOM parsing. |

**One volume, four viewports.** `createAndCacheVolume` builds a single volume in
GPU memory; `setVolumesForViewports` attaches it to three `ORTHOGRAPHIC` viewports
(axial/sagittal/coronal) and one `VOLUME_3D`. Nothing is loaded twice.

**The adapter boundary exists for teardown.** Cornerstone keeps global state —
rendering engines, tool groups, a volume cache. Concentrating it in
`cornerstone/` makes "open a series, go back, open another" a single explicit
cleanup path rather than a scatter of `useEffect` returns.

## Decisions worth knowing

- **DICOMweb rather than a custom API.** The frontend is a stock Cornerstone3D
  client; an OHIF instance could point at this backend unmodified.
- **Measurements are DICOM objects, not rows.** A Structured Report is written
  into the store as its own series and parsed back on read, so the measurement
  *is* the standard object rather than a private table that happens to export
  one. It is retrievable over the WADO-RS endpoint that already existed.
- **The store holds non-image instances.** Ingest used to require `PixelData`
  on every file. Teaching it that a DICOM instance need not be an image is what
  made the report storable.
- **A segmentation is an image, and still not a series to open.** A SEG carries
  `PixelData`, so it takes the ordinary image path through ingest rather than
  the non-image plumbing the report needed. It is excluded from the browser by
  its SOP Class instead, with the reason "segmentation, not an image series" —
  a geometric rejection would have been a lie.
- **The mask crosses the wire as raw bytes, not as DICOM.** The client holds a
  labelmap volume that is already one uint8 per voxel in the volume's own index
  order, so `PUT` sends exactly that and the backend reshapes it. Encoding to a
  SEG in the browser would mean shipping a DICOM writer to do work the backend
  already does, and the byte order is a reshape, never a transpose.
- **The SEG's frames are mapped back by source SOP Instance UID.** On read,
  `get_pixels_by_source_instance` re-associates each frame with the slice it
  was painted on, so a SEG that omits its empty frames still reconstructs into
  the right planes. Addressing frames by position would break the moment
  `omit_empty_frames` dropped one.
- **Volume validation is a gate, not a warning.** A series that is not a regular
  3D grid cannot be opened; the browser greys it out with the geometric reason.
- **Backend is modality-agnostic.** It validates geometry, not anatomy. The
  brain-only scope lives in the sample manifest and the preset lists.
- **Port 8001**, because `iphlpsvc` commonly holds 8000 on Windows.
- **`events` aliased to the userland polyfill** in `vite.config.ts`: vtk.js pulls
  in `xmlbuilder2`, whose `XMLBuilderCBImpl extends EventEmitter`, and Vite stubs
  bare Node builtins as empty modules for the browser.
