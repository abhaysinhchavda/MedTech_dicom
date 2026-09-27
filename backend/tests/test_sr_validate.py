from __future__ import annotations

from typing import Any

import pytest

from app.sr import MeasurementItem, MeasurementValue, Plane
from app.sr.validate import SrValidationError, derive_values, validate_set

PLANE = Plane(normal=(0.0, 0.0, 1.0), up=(0.0, -1.0, 0.0))
UID = "2.25.100000000000000000000000000000001"


def item(**over: Any) -> MeasurementItem:
    base: dict[str, Any] = dict(
        id=UID,
        tool="Length",
        points=[(0.0, 0.0, 0.0), (3.0, 4.0, 0.0)],
        plane=PLANE,
        values=[MeasurementValue("Length", 5.0, "mm")],
        label=None,
    )
    return MeasurementItem(**{**base, **over})


def test_a_consistent_length_is_accepted() -> None:
    validate_set([item()], frame_of_reference_uid="1.2")


def test_wrong_point_count_is_rejected() -> None:
    with pytest.raises(SrValidationError, match="expects 2 points"):
        validate_set([item(points=[(0.0, 0.0, 0.0)])], frame_of_reference_uid="1.2")


def test_unknown_tool_is_rejected() -> None:
    with pytest.raises(SrValidationError, match="unknown tool"):
        validate_set([item(tool="Sphere")], frame_of_reference_uid="1.2")


def test_a_uuid_id_is_rejected() -> None:
    # It would be written as a Tracking Unique Identifier, whose VR is UI.
    with pytest.raises(SrValidationError, match="not a DICOM UID"):
        validate_set(
            [item(id="3f2a9c1e-0000-4000-8000-000000000001")], frame_of_reference_uid="1.2"
        )


def test_non_finite_coordinate_is_rejected() -> None:
    with pytest.raises(SrValidationError, match="not finite"):
        validate_set(
            [item(points=[(0.0, 0.0, 0.0), (float("nan"), 0.0, 0.0)])],
            frame_of_reference_uid="1.2",
        )


def test_a_length_is_recomputed_from_its_own_coordinates() -> None:
    # Cornerstone measures in index space with a calibration scale, so its
    # figure is not the Euclidean distance between the world points it stores.
    # The report has to be self-consistent, so the coordinates win.
    derived = derive_values(item(values=[MeasurementValue("Length", 99.0, "mm")]))
    assert derived == [MeasurementValue("Length", 5.0, "mm")]


def test_an_angle_is_recomputed_from_its_own_coordinates() -> None:
    # Vertex is the middle point, so the arms are (-1,0,0) and (0,1,0): 90
    # degrees, whatever the client claimed.
    derived = derive_values(
        item(
            tool="Angle",
            points=[(0.0, 0.0, 0.0), (1.0, 0.0, 0.0), (1.0, 1.0, 0.0)],
            values=[MeasurementValue("Angle", 999.0, "deg")],
        )
    )
    assert derived == [MeasurementValue("Angle", 90.0, "deg")]


def test_a_degenerate_angle_is_rejected() -> None:
    with pytest.raises(SrValidationError, match="zero-length arm"):
        validate_set(
            [
                item(
                    tool="Angle",
                    points=[(0.0, 0.0, 0.0), (0.0, 0.0, 0.0), (1.0, 1.0, 0.0)],
                    values=[MeasurementValue("Angle", 45.0, "deg")],
                )
            ],
            frame_of_reference_uid="1.2",
        )


BIDIRECTIONAL_POINTS = [
    (0.0, 0.0, 0.0),
    (20.0, 0.0, 0.0),
    (10.0, -5.0, 0.0),
    (10.0, 5.0, 0.0),
]


def test_both_bidirectional_axes_are_recomputed_from_their_coordinates() -> None:
    derived = derive_values(
        item(
            tool="Bidirectional",
            points=BIDIRECTIONAL_POINTS,
            values=[
                MeasurementValue("LongAxis", 999.0, "mm"),
                MeasurementValue("ShortAxis", 999.0, "mm"),
            ],
        )
    )
    assert derived == [
        MeasurementValue("LongAxis", 20.0, "mm"),
        MeasurementValue("ShortAxis", 10.0, "mm"),
    ]


def test_a_degenerate_bidirectional_axis_is_rejected() -> None:
    with pytest.raises(SrValidationError, match="ShortAxis has zero length"):
        validate_set(
            [
                item(
                    tool="Bidirectional",
                    points=[*BIDIRECTIONAL_POINTS[:2], (10.0, 0.0, 0.0), (10.0, 0.0, 0.0)],
                    values=[MeasurementValue("LongAxis", 20.0, "mm")],
                )
            ],
            frame_of_reference_uid="1.2",
        )


def test_probe_and_roi_values_are_left_alone() -> None:
    roi = item(
        tool="EllipticalROI",
        points=[(0.0, 5.0, 0.0), (10.0, 5.0, 0.0), (5.0, 0.0, 0.0), (5.0, 10.0, 0.0)],
        values=[MeasurementValue("Area", 78.54, "mm2"), MeasurementValue("Mean", 112.5, "1")],
    )
    assert derive_values(roi) == roi.values


def test_a_missing_frame_of_reference_is_rejected() -> None:
    with pytest.raises(SrValidationError, match="frame of reference"):
        validate_set([item()], frame_of_reference_uid="")


def test_roi_statistics_are_taken_on_trust() -> None:
    roi = item(
        tool="EllipticalROI",
        points=[(0.0, 5.0, 0.0), (10.0, 5.0, 0.0), (5.0, 0.0, 0.0), (5.0, 10.0, 0.0)],
        values=[MeasurementValue("Area", 1.0, "mm2")],  # nonsense, accepted
    )
    validate_set([roi], frame_of_reference_uid="1.2")
