# Data Flow — DICOM 3D Brain Viewer

Five flows: files in, series list out, volume on screen, measurements to a
report and back, and a painted mask to a Segmentation and back.

## 1. Ingest — DICOM file → indexed volume

Runs on startup for `SAMPLES_DIR`, and per request for `POST /api/upload`.
Same pipeline both ways (`ingest/indexer.py::ingest_files`).

```
file ─▶ reader.read_dicom ─▶ decode.to_uncompressed ─▶ store.file_instance ─▶ indexer.index_instance
         │                    │                         │                      │
         │ rejects: not DICOM │ JPEG2000 / JPEG-LS / RLE│ store/<study>/       │ one transaction:
         │ missing SOP/Series/│ → Explicit VR LE.       │ <series>/<sop>.dcm   │ study + series + instance
         │ Study UID, malformed│ SOP UID preserved      │ path contained under │ (InstanceRow built first,
         │ UID syntax, no      │ (generate_instance_uid │ store_dir            │  so a malformed file
         │ PixelData           │  =False)               │                      │  leaves no phantom rows)
         ▼                                                                      ▼
    SkippedFile(file, reason) ───────────────────────────────────────────▶ IngestSummary
                                                                                │
                              once per touched series ──▶ indexer.finalize_series
                                                              │
                              geometry.sort_instances ────────┤  key = dot(IPP, normal),
                              geometry.volume_info  ──────────┘  normal = cross(IOP rows, IOP cols)
                                                              │
                                                              ▼
                                         series row: instance_count, frame_count, thumb_sop_uid,
                                         sort_method, is_volume, reason, dims, spacing, origin, direction
```

**Failure is per file, never per batch.** A non-DICOM file, an undecodable
transfer syntax or a malformed UID produces a `SkippedFile` with a reason; the
rest of the upload still lands. `POST /api/upload` answers `200` with
`{accepted, skipped[], studyUids[]}` even when some files were skipped.

**Volume validation, first failure wins:** sort method must be `geometry` →
≥ 3 slices → identical dimensions/pixel spacing → single orientation → uniform
slice gaps within 1 % of the median. Each failure stores a human-readable reason.

## 2. Browse — studies and series

```
BrowserPage
  ├─ StudyList     ── useQuery ['studies']            ─▶ GET /dicomweb/studies      ─▶ QIDO JSON → Study[]
  └─ SeriesGrid    ── useQuery ['series', studyUid]   ─▶ GET /dicomweb/.../series   ─▶ QIDO JSON → Series[]
                   └─ useQueries ['volume-info', uid] ─▶ GET /api/series/{uid}/volume-info
                                                                   │
        card state = info === undefined → "checking…", not a link  │
                     info.isVolume      → link + dims              │
                     !info.isVolume     → greyed + reason ◀────────┘
        thumbnail   = GET .../instances/{thumbSopUid}/rendered?viewport=160,160  (PNG, plain <img>)
```

`['volume-info', seriesUid]` is the same query key the viewer uses, so clicking a
card opens against already-cached info — no second request.

## 3. View — series → four synchronised panels

```
ViewerPage ── useVolume(studyUid, seriesUid)
   │
   │  status: info ─▶ metadata ─▶ loading ─▶ ready          (or blocked / error)
   │           │         │          │
   │           │         │          └─ loadVolume(volumeId, imageIds, onProgress, signal)
   │           │         │                │  volumeLoader.createAndCacheVolume → volume.load()
   │           │         │                │  IMAGE_VOLUME_MODIFIED          → progress
   │           │         │                │  IMAGE_VOLUME_LOADING_COMPLETED → resolve
   │           │         │                │  IMAGE_LOAD_ERROR               → release + reject "slice N failed"
   │           │         │                │  AbortSignal                    → release + reject AbortError
   │           │         └─ GET .../metadata  →  instances (sorted) + X-Sort-Method
   │           │              buildImageIds  → wadors:<frameUrl> one per frame
   │           │              seedMetadata   → wadors.metaDataManager (loader needs no extra requests)
   │           └─ GET /api/series/{uid}/volume-info
   │                isVolume === false → status 'blocked', reason shown, nothing loaded
   │                estimatedBytes > 1 GB → window.confirm before loading
   ▼
ViewerLayout (status === 'ready')
   createViewerLayout → 3 × ORTHOGRAPHIC (AXIAL/SAGITTAL/CORONAL) + 1 × VOLUME_3D
   showVolume         → setVolumesForViewports(one volumeId, all four) + default 3D preset + resetCamera
   createToolGroups   → MPR: Crosshairs/WindowLevel · Pan · Zoom · StackScroll
                        3D : TrackballRotate · Pan · Zoom
        │
        │  Cornerstone fetches frames lazily:  GET .../frames/{n}  →  multipart/related octet-stream
        │
        └─ useViewportState per panel: VOI_MODIFIED · CAMERA_MODIFIED · VOLUME_NEW_IMAGE · IMAGE_RENDERED
                                          → { sliceIndex, numSlices, voi, zoom } → ViewportOverlay
```

**Crosshair sync** is Cornerstone's `CrosshairsTool` bound to the three MPR
viewport ids: dragging in one plane moves the camera of the other two, which
emits `CAMERA_MODIFIED`, which updates their slice counters.

**Teardown on unmount** (series switch or back): abort the in-flight load,
`destroyToolGroups()`, `destroyViewerLayout(engine)`, `releaseVolume(volumeId)`.
`useVolume`'s started-latch is keyed to `seriesUid`, so a route param change
loads the new series instead of reporting the old one as ready.

## 4. Measure - annotation to Structured Report and back

```
Toolbar tool mode ──▶ left-drag on an MPR viewport
        │  Cornerstone fires ANNOTATION_COMPLETED on its global eventTarget
        ▼
useMeasurements marks the set dirty ──▶ Save enables
        │
        ▼
PUT /api/series/{uid}/measurements   { srSopUid, measurements[] }
        │
        ├─ validate: tool name, point count, UID syntax, frame of
        │            reference, finite coordinates      -> 422
        ├─ derive: Length and Angle recomputed from the coordinates, so the
        │          NUM and the SCOORD3D beside it always agree
        ├─ srSopUid still current?                      -> 409 if not
        ├─ sr/build.py: Comprehensive3DSR, TID 1500, SCOORD3D in world mm
        ├─ store.file_instance -> data/store/<study>/<sr-series>/<sop>.dcm
        ├─ index_instance + finalize_series  (is_volume 0, no thumbnail)
        └─ delete the previous report: file, then row
        ▼
      new srSopUid; dirty clears
```

```
Reopening the series
  useMeasurements ── GET /api/series/{uid}/measurements
        │  repo: series WHERE derived_from_series_uid = uid AND modality = 'SR'
        │  newest instance wins  ──▶ sr/parse.py ──▶ wire JSON
        ▼
  annotations.ts: addAnnotation() per measurement, keyed by
  FrameOfReferenceUID, with the view plane restored to metadata and the
  annotation marked invalidated so Cornerstone recomputes its numbers
  against the volume that is actually loaded
```

**Why the save order matters.** The new report is written and indexed *before*
the old one is deleted. A crash in between leaves two reports, of which the
newest wins and the other is inert; the reverse order could lose the only copy.

## 5. Segment - painted labelmap to a Segmentation object and back

```
Toolbar Brush + Segment select ──▶ left-drag on an MPR viewport
        │  Cornerstone paints into a derived labelmap volume, one uint8 per
        │  voxel, and fires SEGMENTATION_DATA_MODIFIED on its global eventTarget
        ▼
useSegmentation marks the mask dirty ──▶ Save segmentation enables
        │  readLabelmap: voxelManager.getCompleteScalarDataArray() -> Uint8Array
        ▼
PUT /api/series/{uid}/segmentation   multipart: meta JSON + labelmap bytes
        │
        ├─ series is a volume?                           -> 422 with the reason
        ├─ validate: byte count == nx*ny*nz, segment numbers positive and
        │            unique, tracking uid is a legal DICOM UID, every
        │            non-zero voxel value is declared                 -> 422
        ├─ every voxel zero?  -> delete the stored SEG and its series, return
        │                        an envelope with no segSopUid
        ├─ segSopUid still current?                      -> 409 if not
        ├─ mask.labels_from_bytes: reshape to (nz, ny, nx). A reshape, never a
        │  transpose - the wire order is index = x + y*nx + z*nx*ny
        ├─ mask.split_segments: one boolean plane stack per segment number
        ├─ segmentation/build.py: Segmentation, BINARY, omit_empty_frames,
        │  coded category/type per segment, source images prepared so
        │  highdicom finds the patient and study attributes it requires
        ├─ store.file_instance -> data/store/<study>/<seg-series>/<sop>.dcm
        ├─ index_instance + finalize_series  (SEG takes the ordinary image
        │  path - it has PixelData - and is excluded from the browser by its
        │  SOP Class, reason "segmentation, not an image series")
        └─ delete the previous SEG: file, then row
        ▼
      new segSopUid; dirty clears
```

```
Reopening the series
  useSegmentation ── GET /api/series/{uid}/segmentation      (segments + dims)
                  └─ GET /api/series/{uid}/segmentation/labelmap   (raw bytes)
        │  repo: series WHERE derived_from_series_uid = uid AND modality = 'SEG'
        │  newest instance wins  ──▶ segmentation/parse.py
        │      get_pixels_by_source_instance(..., combine_segments=True,
        │      relabel=False, assert_missing_frames_are_empty=True)
        │      frames re-associated by source SOP Instance UID, so a SEG that
        │      omitted its empty frames still lands on the right planes
        ▼
  segmentation.ts: createLabelmap (derived from the image volume) ->
  fillLabelmap (setCompleteScalarDataArray, bytes unchanged) ->
  showSegmentation on the three MPR viewports only
```

**The mask and the report save independently.** Two dirty flags, two buttons,
two stored objects in two derived series. Painting never marks a measurement
dirty and vice versa, so neither save can clobber the other's work.

## Error paths

| Where | Behaviour |
|---|---|
| Backend unreachable | `ErrorBanner` + retry on the browser |
| Series not a volume | Viewer refuses to open; reason shown |
| One frame fails | Load aborted, partial volume released, slice named |
| Unknown UID | `404` with `{detail}` |
| Upload too large / bad zip / path traversal | `413` / `400`, message shown in the dropzone |
| WebGL2 missing | Full-page "WebGL2 required" instead of a blank canvas |
| Report unreadable | Empty set plus `parseError`; the viewer still opens, with a non-blocking notice |
| Report changed elsewhere | `409`; the save is refused and the set stays dirty |
| Series has no frame of reference | Measurement tools disabled, with the reason on hover |
| Segmentation unreadable | No segments plus `parseError`, `labelmap` answers `404`; the series still opens, with a non-blocking notice, and painting replaces the object |
| Segmentation changed elsewhere | `409`; the save is refused and the mask stays dirty |
| Labelmap length disagrees with the series' dims | `422` naming both the expected and the received byte count |
| A voxel value no segment declares | `422`; a mask is never stored with a label nothing describes |
| Series is not a volume | Brush, segment select and save disabled, with the reason on hover; `PUT` also refuses with `422` |
