import random

import pytest

from app.geometry import sort_instances, volume_info
from app.models import InstanceRow

# Sentinel distinguishes "inst not given" (defaults to i) from "inst=None" (explicitly missing).
_UNSET = object()


def row(i: int, *, ipp=None, iop=(1, 0, 0, 0, 1, 0), inst=_UNSET, rows=16, cols=16, ps=(0.5, 0.5),
        path=None, frames=1) -> InstanceRow:
    instance_number = i if inst is _UNSET else inst
    return InstanceRow(
        sop_uid=f"1.{i}", series_uid="S", instance_number=instance_number,
        rows=rows, cols=cols, bits_allocated=16, pixel_representation=1, samples_per_pixel=1,
        num_frames=frames, ipp=ipp, iop=iop, pixel_spacing=ps,
        path=path or f"img{i:04d}.dcm", transfer_syntax="1.2.840.10008.1.2.1",
    )


def axial(n: int, dz: float = 1.0) -> list[InstanceRow]:
    return [row(i, ipp=(0.0, 0.0, i * dz)) for i in range(n)]


def test_sorts_axial_by_position_not_instance_number() -> None:
    rows = [row(i, ipp=(0, 0, 10 - i), inst=i) for i in range(5)]
    out, method = sort_instances(rows)
    assert method == "geometry"
    assert [r.ipp[2] for r in out] == [6, 7, 8, 9, 10]


def test_sorts_shuffled_coronal() -> None:
    iop = (1, 0, 0, 0, 0, -1)  # normal = (0, 1, 0)
    rows = [row(i, ipp=(0, i * 2.0, 0), iop=iop) for i in range(10)]
    random.Random(1).shuffle(rows)
    out, method = sort_instances(rows)
    assert method == "geometry" and [r.ipp[1] for r in out] == [i * 2.0 for i in range(10)]


def test_sorts_oblique() -> None:
    iop = (0.7071, 0.7071, 0, -0.7071, 0.7071, 0)  # normal ~ (0,0,1)
    rows = [row(i, ipp=(i, i, i * 3.0), iop=iop) for i in reversed(range(4))]
    out, _ = sort_instances(rows)
    assert [r.ipp[2] for r in out] == [0.0, 3.0, 6.0, 9.0]


def test_missing_ipp_falls_back_to_instance_number() -> None:
    rows = [row(3, inst=3), row(1, inst=1), row(2, inst=2)]
    out, method = sort_instances(rows)
    assert method == "instance-number" and [r.instance_number for r in out] == [1, 2, 3]


def test_missing_everything_falls_back_to_filename() -> None:
    rows = [row(0, inst=None, path="b.dcm"), row(1, inst=None, path="a.dcm")]
    out, method = sort_instances(rows)
    assert method == "filename" and [r.path for r in out] == ["a.dcm", "b.dcm"]


def test_mixed_orientation_falls_back() -> None:
    rows = axial(4)
    rows[-1] = row(3, ipp=(0, 0, 3.0), iop=(1, 0, 0, 0, 0, -1))
    _, method = sort_instances(rows)
    assert method == "instance-number"


def test_regular_series_is_volume() -> None:
    rows = [row(i, ipp=(0, 0, i * 2.5), rows=16, cols=32, ps=(0.5, 0.7)) for i in range(20)]
    out, m = sort_instances(rows)
    v = volume_info(out, m)
    assert v.is_volume and v.reason is None
    # dims/spacing are (x=cols, y=rows, z); PixelSpacing is [row spacing, col spacing],
    # so a non-square rows/cols and a non-square pixel_spacing actually exercise the swap.
    assert v.dims == (32, 16, 20)
    assert v.spacing == pytest.approx((0.7, 0.5, 2.5))
    assert v.origin == (0.0, 0.0, 0.0)
    assert v.direction == pytest.approx((1, 0, 0, 0, 1, 0, 0, 0, 1))


def test_degenerate_orientation_falls_back() -> None:
    # Row and column cosines are identical/parallel -> cross product norm ~0 -> no
    # well-defined slice normal. Must not be treated as a valid geometry orientation.
    iop = (1, 0, 0, 1, 0, 0)
    rows = [row(i, ipp=(0, 0, float(i)), iop=iop) for i in range(4)]
    out, method = sort_instances(rows)
    assert method == "instance-number"
    v = volume_info(out, method)
    assert v.reason == "missing or inconsistent orientation"


def test_spacing_uses_median_gap_not_slice_thickness() -> None:
    rows = axial(11, dz=0.7)
    v = volume_info(*sort_instances(rows))
    assert v.spacing[2] == pytest.approx(0.7)


@pytest.mark.parametrize(
    "rows, reason",
    [
        ([row(0, inst=0), row(1, inst=1), row(2, inst=2)], "missing or inconsistent orientation"),
        (axial(2), "fewer than 3 slices"),
        (axial(3)[:2] + [row(2, ipp=(0, 0, 2.0), rows=32)], "inconsistent image dimensions"),
        (axial(3)[:2] + [row(2, ipp=(0, 0, 2.0), ps=(1.0, 1.0))], "inconsistent image dimensions"),
        (axial(4)[:3] + [row(3, ipp=(0, 0, 3.5))], "irregular slice spacing"),
        (axial(4)[:3] + [row(3, ipp=(0, 0, 2.0))], "irregular slice spacing"),  # duplicate position
    ],
)
def test_volume_failures(rows, reason) -> None:
    v = volume_info(*sort_instances(rows))
    assert not v.is_volume and v.reason == reason and v.dims is None


def test_multiframe_counts_frames() -> None:
    # A single multi-frame instance has IPP/IOP so it sorts by geometry, and its 5
    # frames pass the >=3-slices check -- but volume_info treats multi-frame series
    # as unsupported in v1.
    rows = [row(0, ipp=(0, 0, 0), frames=5)]
    out, method = sort_instances(rows)
    assert method == "geometry"
    v = volume_info(out, method)
    assert v.is_volume is False
    assert v.reason == "irregular slice spacing"
    assert v.dims is None
