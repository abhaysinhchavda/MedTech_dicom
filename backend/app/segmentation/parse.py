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
    """A SEG dataset to a (nz, ny, nx) label volume plus its segments.

    `source_sop_uids` must be the reference series' instances in the same
    geometry-sorted order the volume uses: the returned array's slice axis is
    that order, and nothing inside the SEG itself defines it for us.

    The reader is `get_pixels_by_source_instance`, not the similarly named
    `get_pixels_by_source_frame`. The latter addresses frames *within* a
    multi-frame source image; ours are single-frame instances, and it fails
    with a TypeError on a None frame count.
    """
    if str(ds.get("SOPClassUID", "")) != SEGMENTATION_STORAGE:
        raise SegParseError("dataset is not a Segmentation instance")
    try:
        seg = hd.seg.Segmentation.from_dataset(ds, copy=False)
    except Exception as e:  # highdicom raises several unrelated types here
        raise SegParseError(f"{type(e).__name__}: {e}") from e

    segments = _segments(ds)
    if not segments:
        raise SegParseError("segmentation declares no segments")
    try:
        # combine_segments with relabel=False returns one array whose values
        # are the original segment numbers, which is already the label volume.
        pixels = seg.get_pixels_by_source_instance(
            source_sop_instance_uids=list(source_sop_uids),
            segment_numbers=[s.number for s in segments],
            combine_segments=True,
            relabel=False,
            # Frames with no paint were omitted at write time.
            assert_missing_frames_are_empty=True,
        )
    except Exception as e:
        raise SegParseError(f"{type(e).__name__}: {e}") from e
    return np.asarray(pixels).astype(np.uint8), segments
