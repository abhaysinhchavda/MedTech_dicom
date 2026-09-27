from __future__ import annotations

from dataclasses import dataclass, field

Point3 = tuple[float, float, float]

# Cornerstone's tool names are used verbatim as the wire `tool` value, so
# neither side needs a translation table.
TOOL_POINT_COUNTS: dict[str, int] = {
    "Probe": 1,
    "Length": 2,
    "Angle": 3,
    "EllipticalROI": 4,
    # RECIST: long axis first, then the short axis perpendicular to it.
    "Bidirectional": 4,
}


@dataclass(frozen=True)
class MeasurementValue:
    name: str
    value: float
    unit: str


@dataclass(frozen=True)
class Plane:
    normal: Point3
    up: Point3


@dataclass(frozen=True)
class MeasurementItem:
    # `id` is a DICOM UID, not a UUID: it is stored as the Tracking Unique
    # Identifier (DCM 112040), whose value representation is UI. The frontend
    # derives one in the standard 2.25.<uuid-as-integer> form.
    id: str
    tool: str
    points: list[Point3]
    plane: Plane
    values: list[MeasurementValue]
    label: str | None = None


@dataclass(frozen=True)
class MeasurementSet:
    series_uid: str
    frame_of_reference_uid: str | None
    sr_series_uid: str | None = None
    sr_sop_uid: str | None = None
    parse_error: str | None = None
    measurements: list[MeasurementItem] = field(default_factory=list)
