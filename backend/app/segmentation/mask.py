from __future__ import annotations

from collections.abc import Sequence

import numpy as np

from app.segmentation.models import Dims, Segment


def labels_from_bytes(raw: bytes, dims: Dims) -> np.ndarray:
    """Wire bytes to a (nz, ny, nx) label volume.

    The wire order is index = x + y*nx + z*nx*ny, which is Cornerstone's
    scalar data layout. numpy's C order over (nz, ny, nx) is the same walk, so
    this is a reshape and never a transpose. A length mismatch is fatal rather
    than padded or truncated: the wrong length means the two sides disagree
    about the volume, and silently coercing it would paint the wrong voxels.
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
    the shape highdicom wants. Segments cannot overlap coming out of here, by
    construction: a voxel holds exactly one number.
    """
    if not segments:
        return np.zeros((0, *labels.shape), dtype=bool)
    return np.stack([labels == s.number for s in segments])


def combine_segments(planes: np.ndarray, segments: Sequence[Segment]) -> np.ndarray:
    """Boolean planes back to one label volume.

    Later segments win where they overlap. That cannot arise from
    split_segments, but a foreign SEG may legitimately overlap, and producing
    a voxel value with no declared segment would be worse than picking one.
    """
    if not segments:
        shape = planes.shape[1:] if planes.ndim == 4 else planes.shape
        return np.zeros(shape, dtype=np.uint8)
    out = np.zeros(planes.shape[1:], dtype=np.uint8)
    for plane, segment in zip(planes, segments, strict=True):
        out[plane.astype(bool)] = segment.number
    return out
