# Painted Segmentation with DICOM SEG - Design Spec

**Date:** 2026-09-27
**Status:** Approved in brainstorming; awaiting user review of this document
**Builds on:** `2026-09-27-measurements-dicom-sr-design.md` (same architecture, same store)
**Roadmap item:** "labelmap segmentation" from `README.md`

---

## 1. Goal

Let a user paint a segmentation on the MPR planes and have it persist as a real
**DICOM Segmentation** object stored beside the images.

Measurements made the application write one standard derived object. This makes
it write the second, from the same source: the user's own hand. The claim
becomes that the viewer authors both SR and SEG from user input, rather than
reading somebody else's.

## 2. Scope

### In scope

- Painting on the three MPR viewports with Cornerstone's `BrushTool` and
  `PaintFillTool`. **Erasing is the brush with segment 0 selected**, not a
  separate mode: 0 already means unlabelled in the label volume, so the eraser
  falls out of the data model for free and the toolbar, which is already
  crowded, gains a selector entry rather than another button.
- Multiple named segments. The data model supports N from the start; the UI
  ships with one default segment and an "add segment" control.
- Persistence as a **Segmentation** instance (SOP Class
  `1.2.840.10008.5.1.4.1.1.66.4`), `SegmentationType` **BINARY**, written into
  `data/store` as its own SEG series and indexed like any other instance.
- Round trip: reopening the series restores the painted mask and its segments.
- Explicit save with a dirty indicator, independent of the measurements save.

### Out of scope

- **The 3D surface.** No marching cubes, no `Surface` representation. The 3D
  viewport is unchanged in this increment. Deliberate: it needs either
  `@cornerstonejs/polymorphic-segmentation` (which pulls itk-wasm) or
  hand-wired vtk.js, and that risk does not belong in the increment that
  proves the SEG pipeline.
- Reading **arbitrary third-party SEG**. Same position as third-party SR: a
  SEG we cannot parse is reported as unreadable, never crashed on.
- Automatic segmentation of any kind: no thresholding, no region growing, no
  model. The mask comes from the user's hand only.
- Editing a SEG produced elsewhere.
- Segmentation of a series that is not an openable volume. You can only paint
  on something you can open, and only volumes open.

## 3. Approach

**The backend owns the DICOM; the mask crosses as a plain uint8 label volume.**
Cornerstone paints into a derived labelmap volume. On save the frontend ships
those bytes untouched; the backend splits them into one binary plane per
segment and writes the SEG with `highdicom`. On read it recombines.

This keeps the invariant `docs/architecture.md` already states, that the
browser contains no DICOM parsing, and it puts the only format conversion in
Python where the project has real tests.

### Rejected alternatives

**Packed bits on the wire.** Proposed and withdrawn during design. It matches
DICOM's BINARY encoding and is eight times smaller, but Cornerstone's labelmap
is uint8 and `highdicom` wants arrays, so bit-packing would mean writing
bit-fiddling code in TypeScript and testing it against a hand-written mock, to
save bytes that are invisible on localhost. The packing belongs server-side.

**LABELMAP segmentation type.** `highdicom` supports it and it would mean zero
conversion anywhere, since a LABELMAP SEG stores exactly the uint8 array we
already hold. Rejected for interoperability: BINARY is universally readable,
LABELMAP is recent and thinly supported. One tested conversion function is a
better trade than a bet on consumer support.

**The frontend writes the SEG with dcmjs.** Same rejection as the SR: a second
DICOM implementation in a browser that has none, untestable without a real
browser, and it inverts the documented architecture.

**The frontend sends brush strokes and the backend rasterises.** Tiny payloads,
but Cornerstone must paint locally for immediate feedback, so two rasterisers
would have to agree voxel-for-voxel forever. A correctness trap, not a saving.

## 4. Wire format

Metadata and bulk data travel separately, the same split QIDO and WADO already
make in this codebase.

```
GET /api/series/{uid}/segmentation            -> JSON envelope
GET /api/series/{uid}/segmentation/labelmap   -> application/octet-stream, uint8
PUT /api/series/{uid}/segmentation            -> multipart: meta (JSON) + labelmap (binary)
```

`python-multipart` is already a dependency, used by `/api/upload`.

```json
{
  "seriesUid": "1.3.6...",
  "frameOfReferenceUid": "1.3.6...",
  "segSeriesUid": null,
  "segSopUid": null,
  "parseError": null,
  "dims": [192, 256, 60],
  "segments": [
    {
      "number": 1,
      "label": "Tumour",
      "trackingUid": "2.25...",
      "categoryCode": "49755003",
      "typeCode": "372087000"
    }
  ]
}
```

`segSeriesUid` and `segSopUid` are `null` before the first save. As with the
report, this envelope is both the `GET` response and the `meta` part of the
`PUT`, which is what makes the optimistic concurrency check possible.

### Pinned conventions

Both sides must agree exactly or the mask silently lands on the wrong voxels.

- **Voxel order:** `index = x + y*nx + z*nx*ny`. This matches Cornerstone's
  scalar data layout and the geometry-sorted frame order the backend already
  produces for the volume.
- **Length:** exactly `nx*ny*nz` bytes. Any other length is a hard error.
- **Segment numbers are 1-based.** 0 means unlabelled, so a segment's number is
  also its value in the array.
- **`trackingUid`** is a DICOM UID in the `2.25.<uuid-as-integer>` form, the
  same identity slot the measurements use. `SegmentDescription` takes
  `tracking_uid` and `tracking_id` directly, so a segment keeps its identity
  across saves.
- **`categoryCode` / `typeCode`** are DICOM's required coded concepts for what
  a segment *is* (`segmented_property_category` and `segmented_property_type`).
  Verified against pydicom's code dictionary: the default pair is
  `codes.SCT.MorphologicallyAbnormalStructure` (**49755003**) and
  `codes.SCT.NeoplasmPrimary` (**372087000**), which is correct for a primary
  brain tumour. Note that the obvious guess for the type code was wrong, as it
  was for several of the SR concepts; `codes.SCT.Neoplasm` is 108369006 and is
  the more general alternative. Segments carry their own pair, so a later
  non-tumour segment is not forced into this one.

## 5. Backend design

### 5.1 New modules

| Module | Responsibility |
|---|---|
| `app/segmentation/mask.py` | uint8 label volume to per-segment binary planes and back. Pure. |
| `app/segmentation/build.py` | planes + segment metadata to a `Segmentation` dataset. Pure. |
| `app/segmentation/parse.py` | SEG dataset to label volume + segments. Pure. Raises `SegParseError`. |
| `app/segmentation/validate.py` | dims, byte length, declared segments. Raises `SegValidationError`. |
| `app/api/segmentations.py` | the three routes. No DICOM logic, no SQL. |

Same layering rule as `app/sr/`: no HTTP, no SQL below the API module.

Reading uses `highdicom.seg.Segmentation.from_dataset` and
`get_pixels_by_source_frame`, which returns the mask already aligned to the
source frames. That is what keeps `parse.py` from having to reason about the
SEG's per-frame functional groups itself.

### 5.2 A SEG is an image object

Unlike an SR, a SEG carries `PixelData`, so it passes the existing image
required-tag set unchanged and never touches the non-image plumbing the
measurements work added. It is indexed as one instance with
`NumberOfFrames = N`.

`finalize_series` then runs it through the volume check, where `geometry.py`
rejects any multi-frame instance as `"irregular slice spacing"`. That is a
correct rejection with a misleading reason. The fix is targeted: recognise the
Segmentation Storage SOP class and give it
`"segmentation, not an image series"`, exactly as the SR got its own reason.

**This is not the multi-frame geometry project.** Deriving per-frame spacing
from `PerFrameFunctionalGroupsSequence` remains a known limitation and is not
required here, because a SEG is an overlay and never needs to be an openable
volume.

### 5.3 Reused unchanged

`repo.find_derived_series(series_uid, "SEG")`. The `derived_from_series_uid`
column added for the report is generic and already indexed.

### 5.4 The SEG lives in its own series

A new `SeriesInstanceUID` with `Modality = SEG`, in the same study, with
`derived_from_series_uid` pointing at the image series. It cannot go in the
image series for the same reason the report cannot: `finalize_series` iterates
every instance in a series to derive geometry.

Visible consequence: the SEG appears in the study browser as a greyed,
unopenable card stating that it is a segmentation.

### 5.5 Save semantics

`PUT` replaces the whole segmentation for the series, writing a **new** SEG
instance with a fresh SOP Instance UID and deleting its predecessor. Instances
are immutable; rewriting one in place under the same UID would be less code and
the wrong thing.

**An all-zero labelmap deletes the segmentation** rather than writing an object
with no positive voxels, and returns an envelope with `segSopUid: null`.
Erasing everything is a legitimate action and should leave the store clean.

## 6. Frontend design

| Module | Status | Responsibility |
|---|---|---|
| `cornerstone/segmentation.ts` | new | The only module touching Cornerstone's segmentation state. Creates the derived labelmap volume, fills it, registers representations, reads bytes back, releases it. |
| `hooks/useSegmentation.ts` | new | Load, dirty tracking, save, error surfacing. |
| `api/segmentation.ts` | new | `fetch` wrappers including the binary endpoints. |
| `cornerstone/toolGroups.ts` | changed | Register `BrushTool` and `PaintFillTool` on the MPR group; extend `MprTool`. |
| `components/viewer/Toolbar.tsx` | changed | Split into two rows; add brush mode, segment selector, add-segment, and a second Save. |
| `components/viewer/ViewerPage.tsx` | changed | Call `useSegmentation`, thread props, surface `parseError`. |

The labelmap representation is added to the three MPR viewport ids only, never
to the `VOLUME_3D` viewport, which has no surface representation in this
increment.

**The toolbar is the real UX cost.** It already carries seven mode buttons from
the measurement work. Adding brush, eraser, a segment selector and a second
Save means it must become two rows, grouped navigation/measure and
segmentation, rather than wrapping arbitrarily.

**Teardown.** The derived labelmap volume is Cornerstone global state like the
image volume, so leaving the viewer must release it, or the next series
inherits the previous one's mask.

## 7. Data flow

### Opening a series

```
ViewerPage
  |- useVolume(study, series)                        (unchanged)
  |- useMeasurements(series)                         (unchanged)
  `- useSegmentation(series, ready)
        |
        |- GET /api/series/{uid}/segmentation
        |     repo: series WHERE derived_from_series_uid = uid AND modality = 'SEG'
        |     newest instance wins --> parse.py
        |       highdicom from_dataset + get_pixels_by_source_frame
        |       --> one uint8 label volume
        |     none -> { segments: [], segSopUid: null }
        |
        `- GET .../segmentation/labelmap       (only when segSopUid is set)
              application/octet-stream, exactly nx*ny*nz bytes
        v
  segmentation.ts
     createAndCacheDerivedLabelmapVolume(referenceVolumeId, { volumeId: segVolumeId })
     copy the bytes into its scalarData
     addSegmentations([{ segmentationId, representation: Labelmap, data: { volumeId } }])
     addSegmentationRepresentationsToViewport(MPR_IDS, [{ segmentationId }])
```

### Painting and saving

```
Toolbar: Brush --> setActiveMprTool('Brush')   (same single-owner-of-left-drag rule)
   active segment number from the segment selector
   |  paint on any MPR plane; Cornerstone writes into the derived labelmap volume
   |  SEGMENTATION_DATA_MODIFIED --> markDirty
   v
Save --> PUT /api/series/{uid}/segmentation   (multipart)
   meta:     { segSopUid, dims, segments[] }
   labelmap: uint8 bytes from the derived volume's scalarData
   |
   |- validate (see section 8)                       -> 422 / 409
   |- all zero?  -> delete the segmentation, return segSopUid null
   |- mask.py: split into one binary plane per segment
   |- build.py: highdicom Segmentation(source_images, BINARY, segment_descriptions)
   |- store.file_instance -> data/store/<study>/<seg-series>/<sop>.dcm
   |- index_instance + finalize_series
   `- delete the previous SEG: file, then row
   v
 new segSopUid; dirty clears
```

**Measurements and segmentation save independently**, with separate dirty flags
and separate buttons. They write different DICOM objects, either can fail on
its own, and a 409 on one must not block the other.

## 8. Error handling

**Dimension mismatch is the dangerous failure.** A labelmap that does not match
the series would silently paint the wrong voxels and nothing downstream would
notice. The save checks both the declared `dims` against the series' own volume
dimensions from the index, and that the byte length is exactly `nx*ny*nz`.
Either check alone can pass while the other is wrong. Both are a 422, never a
truncation and never a pad.

**An undeclared segment value is rejected, not dropped.** A voxel holding 3
with no segment 3 declared means the two sides disagree about what was painted;
zeroing it silently would lose the user's work without telling them.

**Validation, 422 with a stated reason:**

- declared `dims` do not match the series volume
- labelmap byte length is not `nx*ny*nz`
- a voxel value has no declared segment
- a segment number is not a positive integer, or is duplicated
- a `trackingUid` is not a DICOM UID

**Concurrency.** The client sends the `segSopUid` it loaded. If that is not the
current newest, the save is rejected with **409**.

**Save ordering.** Write the new SEG, index it, then delete the predecessor. A
crash midway leaves two, of which the newest wins and the other is inert; the
reverse order could lose the only copy.

**An unreadable SEG** never stops the series opening. `GET` returns an empty
set with `parseError`, and the viewer shows a non-blocking notice.

**Resource note.** The derived labelmap adds `nx*ny*nz` bytes alongside the
image volume, about 7.8 MB for the 160-slice T1. The existing 1 GB
confirmation counts only the image volume and should include this.

## 9. Testing

### Backend (pytest)

- **`mask.py` round trip both ways**, for one segment and for three. An
  off-by-one in segment numbering or a transposed axis would otherwise surface
  only as a visibly wrong overlay, which no unit test would catch.
- **Build then parse returns the identical label volume.**
- **The object is what it claims:** SOP Class `1.2.840.10008.5.1.4.1.1.66.4`,
  `SegmentationType` BINARY, one `SegmentSequence` item per segment, tracking
  UIDs that survive a save.
- **One test per 422** (dims mismatch, byte-length mismatch, undeclared value,
  bad segment number, bad tracking UID), and one for the 409.
- **An all-zero save removes the object** and returns `segSopUid: null`.
- **Ingest:** a SEG lands in its own series, `is_volume` false with the
  segmentation reason, and the image series is untouched.
- **A corrupt SEG** returns the `parseError` shape, not a 500.
- **The labelmap endpoint** returns exactly `nx*ny*nz` bytes.

### Frontend (vitest)

- `segmentation.ts` byte-array to scalar-data conversion in both directions,
  against a **mocked** `@cornerstonejs/tools`. The mock is deliberate:
  importing it for real starved vitest's worker pool badly enough that three
  unrelated test files failed to start.
- `useSegmentation` dirty tracking, save, 409 surfacing, `parseError`.
- Toolbar: brush mode present, segment selector, save disabled until dirty,
  segmentation controls disabled when the series cannot be segmented.

### End to end (Playwright)

Paint strokes on the axial plane, save, reload, and assert both that the
segment is listed and that fetching the labelmap returns a mask with a non-zero
voxel count.

Asserting on rendered overlay pixels under swiftshader would be flaky;
asserting on the round-tripped mask is not, and it proves the same thing.

## 10. Dependencies

**None new.** `highdicom` is already a runtime dependency from the measurements
work, and its `seg` module is what writes and reads the object.
`@cornerstonejs/tools` already ships `BrushTool`, `PaintFillTool`, the scissors
tools and the whole segmentation state module.

This is a deliberate consequence of deferring the 3D surface, which is the one
part that would have required a new package.

## 11. Risks and open questions

- **`source_images` is the slow step.** `highdicom` needs the referenced
  instances to build per-frame references, so every save reads all of them with
  `stop_before_pixels`: 60 files for the FLAIR, 160 for the T1. Measure it
  before optimising, but expect this to dominate save time.
- **The coded concepts are unverified.** The category/type pair for a brain
  tumour must be looked up in pydicom's code dictionary during implementation.
  The SR work showed the obvious guesses are often absent.
- **Brush behaviour across planes is not fully known.** Cornerstone's brush
  paints a sphere in world space, so a stroke on the axial plane also marks
  neighbouring sagittal and coronal slices. That is correct behaviour, but it
  should be confirmed early, because it shapes what the e2e test can assert.
- **Whether `highdicom` requires `FrameOfReferenceUID`** on the source images
  for a SEG is not confirmed. The sample data has one, so this would only bite
  on an unusual series.
- **Erase-by-selecting-segment-0 is less discoverable** than a dedicated
  eraser button. Decided in favour of the selector because the toolbar is
  already carrying seven modes, but if it confuses in use, promoting it to its
  own button is a one-line change and no data-model change at all.
