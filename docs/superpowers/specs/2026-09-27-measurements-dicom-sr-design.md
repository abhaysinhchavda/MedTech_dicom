# Measurements with DICOM SR Export - Design Spec

**Date:** 2026-09-27
**Status:** Approved in brainstorming; awaiting user review of this document
**Builds on:** `2026-09-21-dicom-web-viewer-design.md` (the viewer this extends)
**Roadmap item:** "Measurements (length / angle / probe)" from `README.md`

---

## 1. Goal

Let a user measure on the MPR planes and have those measurements persist as a
real **DICOM Structured Report** stored alongside the images, not as rows in a
private table.

Today the application can read DICOM well and cannot write anything back. Every
byte in `data/store` came from outside. This feature closes that gap with the
object the standard actually defines for the purpose, which is the difference
between a viewer and something that interoperates.

Two things it demonstrates:

1. **TID 1500 fluency.** Building and parsing a Comprehensive 3D SR with correct
   coded concepts, units, graphic types and tracking identifiers.
2. **A store that holds more than images.** The ingest pipeline currently assumes
   every instance has pixels. Teaching it that a DICOM instance need not be an
   image is a prerequisite, and the same work makes a segmentation object
   possible later.

## 2. Scope

### In scope

- Four measurement tools on the three MPR viewports: **Length, Angle, Probe,
  Elliptical ROI**.
- Values in real units derived from the volume spacing already indexed:
  millimetres, degrees, and for the ROI area plus mean and standard deviation.
- Persistence as a **Comprehensive 3D SR** (SOP Class `1.2.840.10008.5.1.4.1.1.88.34`)
  written into `data/store`, indexed like any other instance, and retrievable
  through the existing WADO-RS instance endpoint.
- **Round trip of our own SR**: reopening a series restores the measurements,
  their values, their labels and the plane they were drawn on.
- Explicit save with a dirty indicator.

### Out of scope

- Reading **arbitrary third-party SR**. TID 1500 in the wild has many variants.
  A report we cannot parse is reported as unreadable, never crashed on. Treat
  broader parsing as a later increment.
- Measurement on the 3D volume viewport. The tools are not registered on that
  tool group.
- Bidirectional, rectangle and freehand ROI. Deferred to a later cut.
- Editing a report produced elsewhere.
- Multi-user attribution, review workflow, or approval state.

## 3. Approach

**The backend authors and parses the SR.** The frontend posts measurements as
plain JSON; `highdicom` builds the SR; the backend writes and indexes it. On
read the backend parses the SR back into the same JSON.

This is the only option consistent with the architecture already documented in
`docs/architecture.md`: *Python does everything that requires understanding
DICOM*, and *the app contains no DICOM parsing of its own*. It also places SR
correctness where the project has real tests. The backend has 83 pytest tests
against real pydicom; the frontend tests Cornerstone-facing code against a
hand-written mock, which would never catch a subtly wrong SR.

### Rejected alternatives

**Frontend authors the SR with dcmjs.** Its Cornerstone3D adapter makes the
happy path shorter, but it puts a second DICOM parser in a browser that
currently has none, makes the standards logic untestable without a real
browser, and inverts the documented architecture.

**Store annotations natively and also emit an SR.** Avoids ever parsing SR
back, at the cost of two sources of truth that can disagree. SR-as-truth was
chosen deliberately; this would undo that.

## 4. Wire format

Coordinates are **world coordinates in millimetres**, against the series'
`FrameOfReferenceUID`. A measurement drawn on an MPR plane does not necessarily
lie on any stored image, so image-relative SCOORD is wrong; SCOORD3D is what
`Comprehensive3DSR` exists for, and it maps one to one onto Cornerstone's
`data.handles.points`.

```json
{
  "seriesUid": "1.3.6...",
  "frameOfReferenceUid": "1.3.6...",
  "srSeriesUid": "1.2.826...",
  "srSopUid": "1.2.826...",
  "parseError": null,
  "measurements": [
    {
      "id": "3f2a9c1e-...",
      "tool": "Length",
      "points": [[-31.2, 14.8, 62.0], [-9.7, 22.4, 62.0]],
      "plane": { "normal": [0, 0, 1], "up": [0, -1, 0] },
      "values": [{ "name": "Length", "value": 22.8, "unit": "mm" }],
      "label": null
    }
  ]
}
```

`srSeriesUid` and `srSopUid` are `null` before the first save. Both are returned
because downloading the report is the existing WADO instance endpoint, which
needs study, series and SOP UIDs.

**This envelope is used in both directions.** It is the `GET` response body and
the `PUT` request body unchanged, which is what makes the optimistic
concurrency check in section 8 possible: the `srSopUid` a client sends back is
the one it loaded. `parseError` is meaningless on a request and is ignored
there.

### Point counts and values per tool

| Tool | Points | SCOORD3D graphic type | Values |
|---|---|---|---|
| `Probe` | 1 | `POINT` | sampled value, modality units |
| `Length` | 2 | `POLYLINE` | length, mm |
| `Angle` | 3 | `POLYLINE` | angle, degrees |
| `EllipticalROI` | 4 | `ELLIPSE` | area mm2, mean, standard deviation |

### Three decisions inside the format

- **`id` and `label` are standard slots.** TID 1500 defines Tracking Unique
  Identifier (DCM 112040) and Tracking Identifier (DCM 112039). The
  per-measurement UUID goes in the former so identity survives a save; the
  user's free-text label goes in the latter. Neither is invented. When `label`
  is null, the Tracking Identifier is written as the tool name, since the
  content item is mandatory in the template.
- **`plane` has no standard slot.** The view plane normal and up vector are
  written as extra numeric content items in the measurement group. A foreign
  reader ignores them and still reads the measurement correctly; without them a
  rehydrated two-point length has no way to recover the plane it was drawn on.
- **Values are computed by the frontend and verified by the backend** wherever
  that is pure geometry. A `Length` whose value disagrees with the distance
  between its own two points, or an `Angle` that disagrees with its three, is
  rejected. Probe and ROI statistics require pixel access and are recorded on
  trust.

## 5. Backend design

### 5.1 New modules

| Module | Responsibility |
|---|---|
| `app/sr/build.py` | wire JSON to `pydicom.Dataset` (Comprehensive 3D SR). Pure. |
| `app/sr/parse.py` | `pydicom.Dataset` to wire JSON. Pure. Raises `SrParseError`. |
| `app/api/measurements.py` | `GET` and `PUT` routes. No SR logic, no SQL. |

`app/sr/` sits at the same layer as `geometry.py`: domain logic, no HTTP, no
SQL. All SQL stays in `repo.py`, per the existing rule.

### 5.2 Non-image instances

`ingest/reader.py` currently requires `PixelData` on every file, and
`indexer.instance_row_from_dataset` reads `Rows`, `Columns` and `BitsAllocated`
unconditionally. An SR has none of these.

- `read_dicom` gains two required-tag sets. Image objects require `PixelData` as
  today. SR objects, identified by `SOPClassUID`, require `ContentSequence`
  instead. UID syntax validation is unchanged and still applies to all three
  UIDs.
- `InstanceRow` relaxes `rows`, `cols`, `bits_allocated`, `pixel_representation`,
  `samples_per_pixel` and `num_frames` to `int | None`.
- `finalize_series` gives a non-image series `is_volume = 0` with the reason
  `"structured report, not an image series"`, and leaves `thumb_sop_uid` null.
  A null thumbnail matters: asking the `rendered` endpoint for a PNG of an SR
  would fail, and the study browser only requests a thumbnail when one is set.

### 5.3 Schema changes

Two nullable columns, plus a migration, because `init_schema` only runs
`CREATE TABLE IF NOT EXISTS` and will not alter an existing store.

```sql
ALTER TABLE instance ADD COLUMN sop_class_uid TEXT;
ALTER TABLE series   ADD COLUMN derived_from_series_uid TEXT;
CREATE INDEX IF NOT EXISTS ix_series_derived ON series(derived_from_series_uid);
```

`sop_class_uid` discriminates image from non-image instances.
`derived_from_series_uid` links the SR series back to the image series it
measures; without it, finding the report for a series means opening every SR in
the study and reading its evidence sequence. The column is generic on purpose
and would serve a segmentation object unchanged.

The migration lives in `db.init_schema`, which `create_app` already calls
eagerly rather than from the lifespan, precisely so an app built without an ASGI
lifespan still gets a schema (`main.py:47`). That makes it the right place: it
runs on every startup and in every test fixture. It reads `PRAGMA table_info`
and adds only the columns that are missing, so it is idempotent and needs no
version table.

### 5.4 The SR lives in its own series

The report gets a new `SeriesInstanceUID` with `Modality = SR`, inside the same
study, with `derived_from_series_uid` pointing at the image series.

It cannot go in the image series: `finalize_series` iterates every instance in a
series to derive geometry, so an SR among the slices would poison the volume
check. A separate series is both standard practice and the only option that
leaves existing code correct.

Visible consequence: the SR series appears in the study browser as a greyed,
unopenable card stating that it is a structured report.

### 5.5 Endpoints

```
GET /api/series/{series_uid}/measurements   -> wire JSON (empty list if none)
PUT /api/series/{series_uid}/measurements   -> wire JSON with the new srSopUid
```

`PUT` replaces the whole set for the series. It writes a **new** SR instance
with a fresh SOP Instance UID and deletes its predecessor. Rewriting an
instance in place under the same UID would be less code and the wrong thing:
DICOM instances are immutable, and any cache between the client and the file
would serve a stale one.

## 6. Frontend design

| Module | Status | Responsibility |
|---|---|---|
| `cornerstone/annotations.ts` | new | The only module that touches Cornerstone's annotation state. Converts between its objects and the wire JSON, restoring `viewPlaneNormal` and `viewUp` into annotation metadata on load. |
| `hooks/useMeasurements.ts` | new | Load on open, track dirty state, save, surface errors. |
| `api/measurements.ts` | new | `fetch` wrappers, flat types. |
| `cornerstone/toolGroups.ts` | changed | Register the four tools on the MPR tool group only. |
| `components/viewer/Toolbar.tsx` | changed | Tool mode selector, Save, dirty indicator, Download report. |

The toolbar carries the real UX cost. Left-drag is currently either crosshairs
or window/level, a two-state toggle. Four measurement tools make that a genuine
tool-mode selector: exactly one of crosshairs, window/level, length, angle,
probe or elliptical ROI is bound to left-drag at a time. Pan, zoom and scroll
keep their existing middle, right and wheel bindings untouched.

Keyboard: the existing shortcuts stay as they are. Tool modes are not given
single-key bindings in this cut, to avoid colliding with `C`, `I` and `R`.

## 7. Data flow

### Opening a series

```
ViewerPage
  |- useVolume(study, series)                      (unchanged)
  `- useMeasurements(series) -- GET /api/series/{uid}/measurements
                                     |
       repo: series WHERE derived_from_series_uid = uid AND modality = 'SR'
                                     |  none -> {measurements: []}
                                     v
       read newest SR instance from data/store -- sr/parse.py --> wire JSON
                                     |
       annotations.ts: addAnnotation() per measurement, keyed by
       FrameOfReferenceUID, plane normal and up restored to metadata
                                     |
       Cornerstone shows each one on the MPR plane whose slice contains it
```

### Drawing and saving

```
Toolbar tool mode --> left-drag on an MPR viewport
       |  Cornerstone fires ANNOTATION_COMPLETED
       v
useMeasurements marks the set dirty --> Save enables
       |
       v
PUT /api/series/{uid}/measurements
       |- validate (see section 8)                 -> 422 / 409
       |- sr/build.py: Comprehensive3DSR, new SOP Instance UID
       |- store.file_instance -> data/store/<study>/<sr-series>/<sop>.dcm
       |- index_instance + finalize_series
       `- delete the previous SR instance: file, then row
       v
     wire JSON with the new srSopUid; dirty clears
```

### Downloading

The existing WADO-RS instance endpoint, using `srSeriesUid` and `srSopUid` from
the GET response. No new route.

## 8. Error handling

**Save ordering.** Write the new file, index it, then delete the predecessor. A
crash midway leaves two reports, of which the newest wins on read, which is
inert. The reverse order could lose the only copy. This mirrors `ingest_files`,
which builds the row before touching the store for the same reason.

**Concurrency.** The client sends the `srSopUid` it loaded. If that is not the
current newest, the save is rejected with **409** rather than silently
overwriting another tab's work.

**Validation, 422 with a stated reason:**

- wrong point count for the tool
- `frameOfReferenceUid` does not match the series
- non-finite coordinate, from a degenerate drag
- unknown tool name
- `Length` or `Angle` value disagrees with its own coordinates beyond 1e-3

**Unreadable report.** A corrupt report, or a foreign one using a TID 1500
variant we do not handle, must never stop the series opening. `GET` returns an
empty set with `parseError` set, and the viewer shows a non-blocking note that a
report exists but could not be read. This follows the pipeline's existing
principle: failures are per item, stated, and never take the batch down.

**No frame of reference.** A series without `FrameOfReferenceUID` cannot carry a
legal SCOORD3D. Measurement is disabled for it with a stated reason, reusing the
idiom the browser already uses for greying a non-volume series.

## 9. Testing

### Backend (pytest)

- **Round trip per tool:** build from wire JSON, parse back, assert identical.
  This is the core of the feature.
- **Output is what it claims:** assert against pydicom that the dataset is a
  Comprehensive 3D SR, carries template identifier 1500, uses the right
  SCOORD3D graphic types, the right units codes for millimetres and degrees, and
  a tracking UID that survives a save.
- **One test per 422 case**, and one for the 409.
- **Ingest:** an SR is accepted, lands in its own series, `is_volume` is false
  with the structured-report reason, `thumb_sop_uid` is null, image columns are
  null, `sop_class_uid` is set.
- **Migration:** a database created without the new columns gains them with its
  rows intact, and running the migration twice is a no-op.
- **Read failures:** no SR returns an empty set; a corrupt SR returns the
  `parseError` shape and not a 500.

### Frontend (vitest)

- `annotations.ts` conversion in both directions against fixture JSON, using the
  existing hand-written Cornerstone mock.
- `useMeasurements` dirty tracking, save, and error surfacing.
- Toolbar mode switching, including that selecting a measurement tool
  deactivates crosshairs.

### End to end (Playwright)

Draw a length on the synthetic 40-slice series, save, reload the page, assert
the measurement is still present with the same value.

This is the most valuable single test in the feature. It is the only one that
exercises real Cornerstone, real highdicom and real SQLite together, and it
closes precisely the gap section 7 of `docs/trd.md` already admits to.

## 10. Dependencies

One new backend dependency: **`highdicom`**, pure Python on top of the pydicom
already present, added to `pyproject.toml` as a runtime dependency. Its TID 1500
API is verbose but it is the only mature Python implementation of the template.

No new frontend dependencies. The measurement tools ship inside
`@cornerstonejs/tools`, which is already installed.

## 11. Risks and open questions

- **`highdicom`'s TID 1500 API is verbose and strict.** The first build of an
  `EllipticalROI` measurement group is the most likely place to lose time.
  Mitigation: implement `Length` end to end first, including the e2e test, then
  add the other three against a proven pipeline.
- **The plane extension is non-standard.** It is additive and ignorable, so it
  does not damage interoperability, but it should be documented in the TRD as a
  deliberate extension rather than left to be discovered.
- **Elliptical ROI statistics need voxel access in the browser.** Cornerstone
  computes these from the loaded volume, so they are available, but they are
  recorded on trust by the backend. If that trust boundary matters later, the
  backend would have to load pixel data to verify, which is a much larger change.
- **Open:** whether the SR series should be hidden from the study browser rather
  than shown greyed. Shown is the default in this spec because it is honest
  about what is in the store, but it does add a card users cannot act on.
