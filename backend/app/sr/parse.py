from __future__ import annotations

from typing import Any

from pydicom.dataset import Dataset

from app.sr.build import PLANE_SCHEME, UNIT_CODES, VALUE_CODES
from app.sr.models import MeasurementItem, MeasurementValue, Plane, Point3

CODE_TO_VALUE_NAME = {c.value: name for name, c in VALUE_CODES.items()}
CODE_TO_UNIT = {c.value: name for name, c in UNIT_CODES.items()}
# POLYLINE is shared by Length and Angle; the point count separates them,
# which is why the wire contract fixes a count per tool.
GRAPHIC_TO_TOOL = {"POINT": "Probe", "ELLIPSE": "EllipticalROI"}
MEASUREMENT_GROUP = "125007"  # DCM, Measurement Group
TRACKING_ID = "112039"
TRACKING_UID = "112040"


class SrParseError(Exception):
    """The dataset is not an SR this application wrote, or is damaged."""


def _children(item: Any) -> list[Dataset]:
    seq = item.get("ContentSequence") if hasattr(item, "get") else None
    return list(seq) if seq else []


def _concept(item: Dataset) -> tuple[str, str] | None:
    try:
        code = item.ConceptNameCodeSequence[0]
        return str(code.CodeValue), str(code.CodingSchemeDesignator)
    except (AttributeError, IndexError):
        return None


def _triples(flat: list[float]) -> list[Point3]:
    if len(flat) % 3:
        raise SrParseError(f"graphic data length {len(flat)} is not a multiple of 3")
    # Stored as FD (64-bit float), so the only loss is whatever the client
    # sent. Rounding to 4 decimal places keeps round-trip equality from
    # tripping on representation noise; 1e-4 mm is far below any voxel size.
    return [
        (round(flat[i], 4), round(flat[i + 1], 4), round(flat[i + 2], 4))
        for i in range(0, len(flat), 3)
    ]


def _groups(root: Dataset) -> list[Dataset]:
    out: list[Dataset] = []
    stack = _children(root)
    while stack:
        item = stack.pop(0)
        if item.ValueType == "CONTAINER":
            concept = _concept(item)
            if concept and concept[0] == MEASUREMENT_GROUP:
                out.append(item)
                continue
        stack.extend(_children(item))
    return out


def _descendants(group: Dataset) -> list[Dataset]:
    """Every item below the group, flattened.

    A measurement's SCOORD3D hangs under its NUM item for a point, line or
    angle, but under the referenced region for an ROI. Flattening means the
    readers below do not have to care which.
    """
    out: list[Dataset] = []
    stack = _children(group)
    while stack:
        item = stack.pop(0)
        out.append(item)
        stack.extend(_children(item))
    return out


def _plane(items: list[Dataset]) -> Plane:
    parts: dict[str, float] = {}
    for item in items:
        if item.ValueType != "NUM":
            continue
        concept = _concept(item)
        if concept and concept[1] == PLANE_SCHEME:
            parts[concept[0]] = float(item.MeasuredValueSequence[0].NumericValue)
    try:
        normal = tuple(round(parts[f"VIEWPLANENORMAL{a}"], 6) for a in "XYZ")
        up = tuple(round(parts[f"VIEWPLANEUP{a}"], 6) for a in "XYZ")
    except KeyError as e:
        raise SrParseError(f"measurement group is missing view plane component {e}") from e
    return Plane(normal=normal, up=up)  # type: ignore[arg-type]


def _tracking(items: list[Dataset]) -> tuple[str, str | None]:
    uid: str | None = None
    identifier: str | None = None
    for item in items:
        concept = _concept(item)
        if concept is None:
            continue
        if concept[0] == TRACKING_UID:
            uid = str(item.UID)
        elif concept[0] == TRACKING_ID:
            identifier = str(item.TextValue)
    if uid is None:
        raise SrParseError("measurement group has no tracking unique identifier")
    return uid, identifier


def _scoord(items: list[Dataset]) -> tuple[str, list[Point3]]:
    for item in items:
        if item.ValueType == "SCOORD3D":
            return str(item.GraphicType), _triples([float(v) for v in item.GraphicData])
    raise SrParseError("measurement group has no SCOORD3D")


def _values(items: list[Dataset]) -> list[MeasurementValue]:
    out: list[MeasurementValue] = []
    for item in items:
        if item.ValueType != "NUM":
            continue
        concept = _concept(item)
        if concept is None or concept[1] == PLANE_SCHEME:
            continue
        if concept[0] not in CODE_TO_VALUE_NAME:
            continue
        mv = item.MeasuredValueSequence[0]
        unit_code = str(mv.MeasurementUnitsCodeSequence[0].CodeValue)
        out.append(
            MeasurementValue(
                name=CODE_TO_VALUE_NAME[concept[0]],
                value=round(float(mv.NumericValue), 4),
                unit=CODE_TO_UNIT.get(unit_code, unit_code),
            )
        )
    return out


def parse_sr(ds: Dataset) -> list[MeasurementItem]:
    groups = _groups(ds)
    if not groups:
        raise SrParseError("no measurement groups found")
    items: list[MeasurementItem] = []
    for group in groups:
        flat = _descendants(group)
        uid, identifier = _tracking(flat)
        graphic_type, points = _scoord(flat)
        tool = GRAPHIC_TO_TOOL.get(graphic_type) or ("Angle" if len(points) == 3 else "Length")
        items.append(
            MeasurementItem(
                id=uid,
                tool=tool,
                points=points,
                plane=_plane(flat),
                values=_values(flat),
                label=None if identifier == tool else identifier,
            )
        )
    return items
