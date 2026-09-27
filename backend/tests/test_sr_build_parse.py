from __future__ import annotations

import pydicom
import pytest
from pydicom.uid import generate_uid

from app.sr import MeasurementItem, MeasurementValue, Plane, build_sr, parse_sr
from tests.conftest import make_ct_series

COMPREHENSIVE_3D_SR = "1.2.840.10008.5.1.4.1.1.88.34"
FOR_UID = "1.2.826.0.1.3680043.8.498.999"


def length_item() -> MeasurementItem:
    return MeasurementItem(
        # A DICOM UIDREF, not a UUID: the tracking identifier is stored as VR
        # UI, and pydicom rejects anything that is not dot-separated digits.
        id="2.25.100000000000000000000000000000001",
        tool="Length",
        points=[(-31.2, 14.8, 62.0), (-9.7, 22.4, 62.0)],
        plane=Plane(normal=(0.0, 0.0, 1.0), up=(0.0, -1.0, 0.0)),
        values=[MeasurementValue(name="Length", value=22.8, unit="mm")],
        label=None,
    )


def build_one(item: MeasurementItem) -> pydicom.Dataset:
    return build_sr(
        [item],
        frame_of_reference_uid=FOR_UID,
        evidence=[make_ct_series(3)[0]],
        sr_series_uid=generate_uid(),
        sr_sop_uid=generate_uid(),
    )


def test_length_round_trips_unchanged() -> None:
    item = length_item()
    assert parse_sr(build_one(item)) == [item]


def test_output_is_a_comprehensive_3d_sr() -> None:
    ds = build_one(length_item())
    assert ds.SOPClassUID == COMPREHENSIVE_3D_SR
    assert ds.Modality == "SR"
    assert len(ds.ContentSequence) > 0


def test_template_1500_is_declared() -> None:
    ds = build_one(length_item())
    templates = [(t.TemplateIdentifier, t.MappingResource) for t in ds.ContentTemplateSequence]
    assert ("1500", "DCMR") in templates


def test_tracking_uid_and_identifier_are_written() -> None:
    item = length_item()
    text = str(build_one(item))
    assert item.id in text  # Tracking Unique Identifier, DCM 112040
    assert "Length" in text  # Tracking Identifier, DCM 112039, from the tool name


def test_label_is_used_as_the_tracking_identifier_when_present() -> None:
    base = length_item()
    labelled = MeasurementItem(
        id=base.id,
        tool=base.tool,
        points=base.points,
        plane=base.plane,
        values=base.values,
        label="tumour long axis",
    )
    assert parse_sr(build_one(labelled))[0].label == "tumour long axis"


def test_graphic_data_survives_to_the_millimetre() -> None:
    parsed = parse_sr(build_one(length_item()))[0]
    assert parsed.points == [(-31.2, 14.8, 62.0), (-9.7, 22.4, 62.0)]
    assert parsed.values[0].value == 22.8
    assert parsed.values[0].unit == "mm"


def test_evidence_without_patient_attributes_is_still_buildable() -> None:
    # highdicom reads PatientBirthDate and friends straight off evidence[0];
    # anonymised and synthetic data often omit them entirely.
    evidence = make_ct_series(1)[0]
    for tag in ("PatientBirthDate", "PatientSex", "StudyID", "AccessionNumber"):
        if tag in evidence:
            delattr(evidence, tag)
    ds = build_sr(
        [length_item()],
        frame_of_reference_uid=FOR_UID,
        evidence=[evidence],
        sr_series_uid=generate_uid(),
        sr_sop_uid=generate_uid(),
    )
    assert ds.SOPClassUID == COMPREHENSIVE_3D_SR


def angle_item() -> MeasurementItem:
    return MeasurementItem(
        id="2.25.100000000000000000000000000000002",
        tool="Angle",
        points=[(0.0, 0.0, 10.0), (10.0, 0.0, 10.0), (10.0, 10.0, 10.0)],
        plane=Plane(normal=(0.0, 0.0, 1.0), up=(0.0, -1.0, 0.0)),
        values=[MeasurementValue(name="Angle", value=90.0, unit="deg")],
        label=None,
    )


def probe_item() -> MeasurementItem:
    return MeasurementItem(
        id="2.25.100000000000000000000000000000003",
        tool="Probe",
        points=[(4.0, 5.0, 6.0)],
        plane=Plane(normal=(1.0, 0.0, 0.0), up=(0.0, 0.0, 1.0)),
        values=[MeasurementValue(name="Mean", value=317.0, unit="1")],
        label=None,
    )


def ellipse_item() -> MeasurementItem:
    return MeasurementItem(
        id="2.25.100000000000000000000000000000004",
        tool="EllipticalROI",
        points=[(0.0, 5.0, 2.0), (10.0, 5.0, 2.0), (5.0, 0.0, 2.0), (5.0, 10.0, 2.0)],
        plane=Plane(normal=(0.0, 0.0, 1.0), up=(0.0, -1.0, 0.0)),
        values=[
            MeasurementValue(name="Area", value=78.54, unit="mm2"),
            MeasurementValue(name="Mean", value=112.5, unit="1"),
            MeasurementValue(name="StandardDeviation", value=18.2, unit="1"),
        ],
        label=None,
    )


@pytest.mark.parametrize(
    "factory", [length_item, angle_item, probe_item, ellipse_item], ids=lambda f: f.__name__
)
def test_every_tool_round_trips_unchanged(factory) -> None:  # type: ignore[no-untyped-def]
    item = factory()
    assert parse_sr(build_one(item)) == [item]


def test_graphic_types_match_the_contract() -> None:
    expected = {
        "Probe": "POINT",
        "Length": "POLYLINE",
        "Angle": "POLYLINE",
        "EllipticalROI": "ELLIPSE",
    }
    for factory in (length_item, angle_item, probe_item, ellipse_item):
        item = factory()
        assert expected[item.tool] in str(build_one(item)), item.tool


def test_several_measurements_in_one_report_keep_their_identities() -> None:
    items = [length_item(), angle_item(), probe_item(), ellipse_item()]
    ds = build_sr(
        items,
        frame_of_reference_uid=FOR_UID,
        evidence=[make_ct_series(3)[0]],
        sr_series_uid=generate_uid(),
        sr_sop_uid=generate_uid(),
    )
    parsed = parse_sr(ds)
    assert {p.id for p in parsed} == {i.id for i in items}
    assert sorted(p.tool for p in parsed) == sorted(i.tool for i in items)
