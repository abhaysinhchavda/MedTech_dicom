from __future__ import annotations

import numpy as np
import pytest

from app.segmentation import Segment
from app.segmentation.mask import (
    combine_segments,
    labels_from_bytes,
    labels_to_bytes,
    split_segments,
)

DIMS = (4, 3, 2)  # nx, ny, nz


def seg(n: int) -> Segment:
    return Segment(
        number=n,
        label=f"S{n}",
        tracking_uid=f"2.25.{n}",
        category_code="49755003",
        type_code="372087000",
    )


def labels() -> np.ndarray:
    a = np.zeros((2, 3, 4), dtype=np.uint8)  # (nz, ny, nx)
    a[0, 1, 2] = 1
    a[1, 0, 0] = 2
    a[1, 2, 3] = 1
    return a


def test_bytes_round_trip_preserves_the_voxel_order() -> None:
    a = labels()
    raw = labels_to_bytes(a)
    assert len(raw) == 4 * 3 * 2
    assert np.array_equal(labels_from_bytes(raw, DIMS), a)


def test_a_wrong_length_buffer_is_rejected() -> None:
    with pytest.raises(ValueError, match="expected 24 bytes"):
        labels_from_bytes(b"\x00" * 23, DIMS)


def test_split_then_combine_is_lossless_for_one_segment() -> None:
    a = np.zeros((2, 3, 4), dtype=np.uint8)
    a[1, 1, 1] = 1
    planes = split_segments(a, [seg(1)])
    assert planes.shape == (1, 2, 3, 4)
    assert np.array_equal(combine_segments(planes, [seg(1)]), a)


def test_split_then_combine_is_lossless_for_three_segments() -> None:
    a = labels()
    a[0, 0, 1] = 3
    segments = [seg(1), seg(2), seg(3)]
    planes = split_segments(a, segments)
    assert planes.shape == (3, 2, 3, 4)
    assert planes[0].sum() == int((a == 1).sum())
    assert planes[1].sum() == int((a == 2).sum())
    assert np.array_equal(combine_segments(planes, segments), a)


def test_segment_numbers_need_not_be_contiguous() -> None:
    a = np.zeros((2, 3, 4), dtype=np.uint8)
    a[0, 0, 0] = 7
    segments = [seg(7)]
    assert np.array_equal(combine_segments(split_segments(a, segments), segments), a)
