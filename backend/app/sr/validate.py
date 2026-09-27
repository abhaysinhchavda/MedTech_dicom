from __future__ import annotations

import math
import re
from collections.abc import Sequence

from app.sr.models import TOOL_POINT_COUNTS, MeasurementItem, Point3

# Millimetres and degrees. Comfortably tighter than any real drag, comfortably
# looser than float noise between the browser's computation and this one.
TOLERANCE = 1e-3

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


def _expected_value(item: MeasurementItem) -> tuple[str, float] | None:
    """The one value this tool's own coordinates determine, if any."""
    if item.tool == "Length":
        return "Length", _norm(_sub(item.points[1], item.points[0]))
    if item.tool == "Angle":
        a, b = _sub(item.points[0], item.points[1]), _sub(item.points[2], item.points[1])
        na, nb = _norm(a), _norm(b)
        if na == 0 or nb == 0:
            raise SrValidationError(f"{item.id}: angle has a zero-length arm")
        cos = max(-1.0, min(1.0, _dot(a, b) / (na * nb)))
        return "Angle", math.degrees(math.acos(cos))
    # A probe samples a voxel and ROI statistics need pixel access; neither is
    # derivable from coordinates alone, so both are recorded on trust.
    return None


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
        check = _expected_value(item)
        if check is None:
            continue
        name, computed = check
        stated = next((v.value for v in item.values if v.name == name), None)
        if stated is None:
            raise SrValidationError(f"{item.id}: {item.tool} has no {name} value")
        if abs(stated - computed) > TOLERANCE:
            raise SrValidationError(
                f"{item.id}: stated {name} {stated} disagrees with its own "
                f"coordinates ({computed:.4f})"
            )
