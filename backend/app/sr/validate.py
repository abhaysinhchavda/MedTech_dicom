from __future__ import annotations

import math
import re
from collections.abc import Sequence

from app.sr.models import TOOL_POINT_COUNTS, MeasurementItem, MeasurementValue, Point3

_DERIVED_UNITS = {"Length": "mm", "Angle": "deg", "LongAxis": "mm", "ShortAxis": "mm"}

# Same syntax the ingest reader enforces on the three instance UIDs: a DICOM
# UI is dot-separated digit groups, at most 64 characters (PS3.5 6.2). The
# measurement id is stored as the Tracking Unique Identifier, VR UI, so a
# browser UUID would be written as an invalid value.
_UID_RE = re.compile(r"^[0-9]+(\.[0-9]+)*$")
_UID_MAX_LEN = 64


class SrValidationError(Exception):
    """A measurement set the client sent cannot be stored as written."""


def _sub(a: Point3, b: Point3) -> Point3:
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _norm(v: Point3) -> float:
    return math.sqrt(v[0] ** 2 + v[1] ** 2 + v[2] ** 2)


def _dot(a: Point3, b: Point3) -> float:
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _expected_values(item: MeasurementItem) -> list[tuple[str, float]]:
    """The values this tool's own coordinates determine, in wire order."""
    if item.tool == "Length":
        return [("Length", _norm(_sub(item.points[1], item.points[0])))]
    if item.tool == "Angle":
        a, b = _sub(item.points[0], item.points[1]), _sub(item.points[2], item.points[1])
        na, nb = _norm(a), _norm(b)
        if na == 0 or nb == 0:
            raise SrValidationError(f"{item.id}: angle has a zero-length arm")
        cos = max(-1.0, min(1.0, _dot(a, b) / (na * nb)))
        return [("Angle", math.degrees(math.acos(cos)))]
    if item.tool == "Bidirectional":
        out: list[tuple[str, float]] = []
        for name, end, start in (("LongAxis", 1, 0), ("ShortAxis", 3, 2)):
            axis = _norm(_sub(item.points[end], item.points[start]))
            if axis == 0:
                raise SrValidationError(f"{item.id}: {name} has zero length")
            out.append((name, axis))
        return out
    # A probe samples a voxel and ROI statistics need pixel access; neither is
    # derivable from coordinates alone, so both are recorded on trust.
    return []


def validate_set(items: Sequence[MeasurementItem], *, frame_of_reference_uid: str) -> None:
    if not frame_of_reference_uid:
        raise SrValidationError("series has no frame of reference, so it cannot be measured")
    for item in items:
        if len(item.id) > _UID_MAX_LEN or not _UID_RE.match(item.id):
            raise SrValidationError(f"measurement id {item.id!r} is not a DICOM UID")
        expected_count = TOOL_POINT_COUNTS.get(item.tool)
        if expected_count is None:
            raise SrValidationError(f"{item.id}: unknown tool {item.tool!r}")
        if len(item.points) != expected_count:
            raise SrValidationError(
                f"{item.id}: {item.tool} expects {expected_count} points, "
                f"got {len(item.points)}"
            )
        for point in item.points:
            if not all(math.isfinite(c) for c in point):
                raise SrValidationError(f"{item.id}: coordinate is not finite")
        for vector in (item.plane.normal, item.plane.up):
            if not all(math.isfinite(c) for c in vector):
                raise SrValidationError(f"{item.id}: view plane is not finite")
        # Raises on a degenerate angle or axis; the values themselves are not
        # checked against the client's, because derive_values replaces them
        # outright.
        _expected_values(item)


def derive_values(item: MeasurementItem) -> list[MeasurementValue]:
    """Recompute the values the coordinates determine, and keep the rest.

    The report must be internally consistent: a consumer that reads the
    SCOORD3D and the NUM beside it has to find them agreeing. Trusting the
    client's number does not give that. Cornerstone measures length in index
    space with a calibration scale (LengthTool._calculateCachedStats maps the
    handles through worldToIndex first), so its figure is deliberately not the
    Euclidean distance between the world-space points it stores, and the two
    diverge on any anisotropic or calibrated volume.

    Probe and ROI statistics are untouched: they need pixel access, which this
    layer does not have, so they stay on the client's word.
    """
    expected = _expected_values(item)
    if not expected:
        return list(item.values)
    derived = [MeasurementValue(n, round(v, 4), _DERIVED_UNITS[n]) for n, v in expected]
    replaced = {n for n, _ in expected}
    return [*derived, *(v for v in item.values if v.name not in replaced)]
