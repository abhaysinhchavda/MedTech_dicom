from __future__ import annotations

from dataclasses import dataclass, field

Dims = tuple[int, int, int]  # nx, ny, nz


@dataclass(frozen=True)
class Segment:
    # 1-based. 0 is reserved for unlabelled, so a segment's number is also its
    # value in the label volume, which is what makes the eraser fall out of
    # the data model for free.
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
