from __future__ import annotations

import re
from collections.abc import Sequence

import numpy as np

from app.segmentation.models import Dims, Segment

# Same syntax the ingest reader enforces on instance UIDs: dot-separated digit
# groups, at most 64 characters (PS3.5 6.2). A segment's tracking uid is
# stored as a UI, so a browser UUID would be written as an invalid value.
_UID_RE = re.compile(r"^[0-9]+(\.[0-9]+)*$")
_UID_MAX_LEN = 64


class SegValidationError(Exception):
    """A segmentation the client sent cannot be stored as written."""


def validate_set(
    labels: np.ndarray, segments: Sequence[Segment], *, dims: Dims, series_dims: Dims
) -> None:
    # The dangerous failure. A labelmap that does not match the series would
    # paint the wrong voxels and nothing downstream would notice, so this is
    # checked alongside the byte length in mask.labels_from_bytes; either
    # check alone can pass while the other is wrong.
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
    # about what was painted. Zeroing it silently would lose the user's work
    # without telling them.
    present = {int(v) for v in np.unique(labels) if v != 0}
    undeclared = sorted(present - seen)
    if undeclared:
        raise SegValidationError(f"labelmap holds undeclared segment values {undeclared}")
