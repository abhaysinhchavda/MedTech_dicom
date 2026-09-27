from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import highdicom as hd
import numpy as np
from pydicom.dataset import Dataset
from pydicom.sr.codedict import codes
from pydicom.sr.coding import Code

from app.source_images import prepared_source_images
from app.sr.models import MeasurementItem, Point3

# Verified against pydicom's code dictionary. The obvious guesses
# (codes.DCM.Length, codes.UCUM.mm, codes.UCUM.degree, codes.DCM.Mean) do not
# exist; do not "simplify" these back.
VALUE_CODES: dict[str, Code] = {
    "Length": codes.SCT.Length,
    "Angle": codes.SCT.Angle,
    "Area": codes.SCT.Area,
    "Mean": codes.SCT.Mean,
    "StandardDeviation": codes.SCT.StandardDeviation,
    "LongAxis": codes.SCT.LongAxis,
    "ShortAxis": codes.SCT.ShortAxis,
}
UNIT_CODES: dict[str, Code] = {
    "mm": codes.UCUM.Millimeter,
    "mm2": codes.UCUM.SquareMillimeter,
    "deg": codes.UCUM.Degree,
    "1": codes.UCUM.NoUnits,
}
# ELLIPSE requires exactly 4 points: both endpoints of the major axis followed
# by both endpoints of the minor axis. Cornerstone's EllipticalROI stores its
# 4 handles in that order, so no reordering is needed.
GRAPHIC_TYPES: dict[str, hd.sr.GraphicTypeValues3D] = {
    "Probe": hd.sr.GraphicTypeValues3D.POINT,
    "Length": hd.sr.GraphicTypeValues3D.POLYLINE,
    "Angle": hd.sr.GraphicTypeValues3D.POLYLINE,
    "EllipticalROI": hd.sr.GraphicTypeValues3D.ELLIPSE,
    "Bidirectional": hd.sr.GraphicTypeValues3D.POLYLINE,
}
# Bidirectional is the only tool whose values have geometry of their own: each
# axis gets its own 2-point POLYLINE, so a reader that takes a NUM and the
# SCOORD3D beside it finds them describing the same segment.
AXIS_SPANS: dict[str, slice] = {"LongAxis": slice(0, 2), "ShortAxis": slice(2, 4)}

# The view plane a measurement was drawn on has no slot in TID 1500. These
# concepts carry it as extra NUM content items inside the measurement group,
# under a private coding scheme. A foreign reader ignores unrecognised
# concepts and still reads the measurement correctly; ours needs them, because
# a reopened two-point length cannot have its plane inferred from 2 points.
PLANE_SCHEME = "99DICOMVIEWER"
_AXES = ("X", "Y", "Z")

def _plane_items(item: MeasurementItem) -> list[hd.sr.NumContentItem]:
    out: list[hd.sr.NumContentItem] = []
    for prefix, vec in (("VIEWPLANENORMAL", item.plane.normal), ("VIEWPLANEUP", item.plane.up)):
        for axis, component in zip(_AXES, vec, strict=True):
            out.append(
                hd.sr.NumContentItem(
                    name=Code(f"{prefix}{axis}", PLANE_SCHEME, f"{prefix} {axis}"),
                    value=float(component),
                    unit=codes.UCUM.NoUnits,
                    relationship_type=hd.sr.RelationshipTypeValues.HAS_PROPERTIES,
                )
            )
    return out


def _graphic_data(points: Sequence[Point3]) -> np.ndarray:
    return np.array([[float(x), float(y), float(z)] for x, y, z in points], dtype=float)


def _group(item: MeasurementItem, frame_of_reference_uid: str) -> Any:
    tracking = hd.sr.TrackingIdentifier(uid=item.id, identifier=item.label or item.tool)
    graphic_type = GRAPHIC_TYPES[item.tool]
    data = _graphic_data(item.points)

    if item.tool == "EllipticalROI":
        # A region measurement: the geometry is the group's referenced region
        # and the numbers hang off it.
        group: Any = hd.sr.PlanarROIMeasurementsAndQualitativeEvaluations(
            tracking_identifier=tracking,
            referenced_region=hd.sr.ImageRegion3D(
                graphic_type=graphic_type,
                graphic_data=data,
                frame_of_reference_uid=frame_of_reference_uid,
            ),
            measurements=[
                hd.sr.Measurement(
                    name=VALUE_CODES[v.name], value=float(v.value), unit=UNIT_CODES[v.unit]
                )
                for v in item.values
            ],
        )
    else:
        # A point, line, angle or axis pair: the geometry is attached to the
        # measurement itself as referenced coordinates, nested under the NUM
        # item. Bidirectional slices the 4 points into one segment per axis;
        # every other tool's single value owns all of them.
        group = hd.sr.MeasurementsAndQualitativeEvaluations(
            tracking_identifier=tracking,
            measurements=[
                hd.sr.Measurement(
                    name=VALUE_CODES[v.name],
                    value=float(v.value),
                    unit=UNIT_CODES[v.unit],
                    referenced_coordinates=[
                        hd.sr.CoordinatesForMeasurement3D(
                            graphic_type=graphic_type,
                            graphic_data=(
                                data[AXIS_SPANS[v.name]] if item.tool == "Bidirectional" else data
                            ),
                            frame_of_reference_uid=frame_of_reference_uid,
                        )
                    ],
                )
                for v in item.values
            ],
        )
    # highdicom's templates are ContentSequence subclasses holding exactly one
    # root CONTAINER; the plane items become its direct children.
    group[0].ContentSequence.extend(_plane_items(item))
    return group


def build_sr(
    items: Sequence[MeasurementItem],
    *,
    frame_of_reference_uid: str,
    evidence: Sequence[Dataset],
    sr_series_uid: str,
    sr_sop_uid: str,
    series_number: int = 99,
    instance_number: int = 1,
) -> Dataset:
    report = hd.sr.MeasurementReport(
        observation_context=hd.sr.ObservationContext(),
        procedure_reported=codes.DCM.ImagingMeasurementReport,
        imaging_measurements=[_group(i, frame_of_reference_uid) for i in items],
        title=codes.DCM.ImagingMeasurementReport,
    )
    return hd.sr.Comprehensive3DSR(
        evidence=prepared_source_images(evidence),
        content=report[0],
        series_instance_uid=sr_series_uid,
        series_number=series_number,
        sop_instance_uid=sr_sop_uid,
        instance_number=instance_number,
        manufacturer="DICOM 3D Brain Viewer",
        is_complete=True,
        is_final=True,
    )
