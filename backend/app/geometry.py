from __future__ import annotations

import statistics

import numpy as np

from app.models import InstanceRow, SortMethod, VolumeInfo

_ORIENT_TOL = 1e-4
_GAP_TOL = 0.01  # 1 % of the median gap


def _normal(iop: tuple[float, ...]) -> np.ndarray:
    n = np.cross(np.array(iop[:3], dtype=float), np.array(iop[3:6], dtype=float))
    result: np.ndarray = n / np.linalg.norm(n)
    return result


def _same_orientation(rows: list[InstanceRow]) -> bool:
    ref_iop = rows[0].iop
    assert ref_iop is not None
    ref = np.array(ref_iop, dtype=float)
    for r in rows:
        assert r.iop is not None
        if not np.allclose(np.array(r.iop, dtype=float), ref, atol=_ORIENT_TOL):
            return False
    return True


def _position(r: InstanceRow, normal: np.ndarray) -> float:
    assert r.ipp is not None
    return float(np.dot(np.array(r.ipp, dtype=float), normal))


def sort_instances(rows: list[InstanceRow]) -> tuple[list[InstanceRow], SortMethod]:
    has_geometry = all(r.ipp is not None and r.iop is not None for r in rows)
    if rows and has_geometry and _same_orientation(rows):
        first_iop = rows[0].iop
        assert first_iop is not None
        normal = _normal(first_iop)
        keyed = sorted(rows, key=lambda r: _position(r, normal))
        return keyed, "geometry"
    if rows and all(r.instance_number is not None for r in rows):
        return sorted(rows, key=lambda r: (r.instance_number, r.path)), "instance-number"
    return sorted(rows, key=lambda r: r.path), "filename"


def _positions(rows: list[InstanceRow]) -> list[float]:
    first_iop = rows[0].iop
    assert first_iop is not None
    normal = _normal(first_iop)
    return [_position(r, normal) for r in rows]


def volume_info(rows: list[InstanceRow], method: SortMethod) -> VolumeInfo:
    if method != "geometry":
        return VolumeInfo(False, "missing or inconsistent orientation")
    n_slices = sum(r.num_frames for r in rows)
    if n_slices < 3:
        return VolumeInfo(False, "fewer than 3 slices")
    first = rows[0]
    sig = (
        first.rows, first.cols, first.bits_allocated,
        first.pixel_representation, first.pixel_spacing,
    )
    if any(
        (r.rows, r.cols, r.bits_allocated, r.pixel_representation, r.pixel_spacing) != sig
        for r in rows
    ):
        return VolumeInfo(False, "inconsistent image dimensions")
    if not _same_orientation(rows):
        return VolumeInfo(False, "mixed orientations")
    if any(r.num_frames != 1 for r in rows):
        # multi-frame spacing not derivable here
        return VolumeInfo(False, "irregular slice spacing")
    pos = _positions(rows)
    gaps = [b - a for a, b in zip(pos, pos[1:], strict=False)]
    median = statistics.median(gaps)
    if median <= 0 or any(abs(g - median) > _GAP_TOL * median for g in gaps):
        return VolumeInfo(False, "irregular slice spacing")
    if first.pixel_spacing is None:
        return VolumeInfo(False, "inconsistent image dimensions")
    pixel_spacing = first.pixel_spacing
    assert first.iop is not None and first.ipp is not None
    iop = first.iop
    ipp = first.ipp
    normal = _normal(iop)
    return VolumeInfo(
        True,
        None,
        dims=(first.cols, first.rows, n_slices),
        spacing=(pixel_spacing[1], pixel_spacing[0], median),
        origin=ipp,
        direction=tuple(float(v) for v in (*iop[:3], *iop[3:6], *normal)),
    )
