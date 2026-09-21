from pydicom.dataelem import DataElement
from pydicom.dataset import Dataset
from pydicom.sequence import Sequence

from app.dicomweb.json_model import dataset_to_dicom_json
from tests.conftest import make_ct_series


def test_pn_and_numeric_typing() -> None:
    (ds,) = make_ct_series(1)
    j = dataset_to_dicom_json(ds)
    assert j["00100010"] == {"vr": "PN", "Value": [{"Alphabetic": "Test^Patient"}]}
    assert j["00280010"] == {"vr": "US", "Value": [16]}
    assert j["00281052"] == {"vr": "DS", "Value": [-1024.0]}
    assert j["00200032"]["Value"] == [0.0, 0.0, 0.0] and j["00200032"]["vr"] == "DS"
    assert j["00200013"] == {"vr": "IS", "Value": [1]}


def test_empty_element_has_no_value_key() -> None:
    ds = Dataset()
    ds.PatientName = ""
    ds.StudyDescription = None
    j = dataset_to_dicom_json(ds)
    assert j["00100010"] == {"vr": "PN"} and j["00081030"] == {"vr": "LO"}


def test_bulk_data_omitted_by_default_and_included_on_request() -> None:
    (ds,) = make_ct_series(1)
    assert "7FE00010" not in dataset_to_dicom_json(ds)
    assert dataset_to_dicom_json(ds, include_bulk=True)["7FE00010"]["vr"] == "OW"


def test_sequences_recurse() -> None:
    ds = Dataset()
    item = Dataset()
    item.CodeValue = "X"
    ds.ProcedureCodeSequence = Sequence([item])
    j = dataset_to_dicom_json(ds)
    assert j["00081032"] == {"vr": "SQ", "Value": [{"00080100": {"vr": "SH", "Value": ["X"]}}]}


def test_private_tag_with_known_vr_is_included_but_unknown_vr_is_bulk() -> None:
    ds = Dataset()
    ds.add(DataElement(0x00090010, "LO", "ACME 1.0"))
    ds.add(DataElement(0x00091001, "UN", b"\x01\x02"))
    j = dataset_to_dicom_json(ds)
    assert j["00090010"] == {"vr": "LO", "Value": ["ACME 1.0"]}
    assert "00091001" not in j
    j_bulk = dataset_to_dicom_json(ds, include_bulk=True)
    assert j_bulk["00091001"]["vr"] == "UN"


def test_pn_ideographic_and_phonetic_components_are_split() -> None:
    ds = Dataset()
    ds.add(DataElement(0x00100010, "PN", "Yamada^Tarou=Yamada^Tarou=Yamada^Tarou"))
    j = dataset_to_dicom_json(ds)
    assert j["00100010"] == {
        "vr": "PN",
        "Value": [
            {
                "Alphabetic": "Yamada^Tarou",
                "Ideographic": "Yamada^Tarou",
                "Phonetic": "Yamada^Tarou",
            }
        ],
    }


def test_matches_pydicom_reference_for_non_bulk() -> None:
    (ds,) = make_ct_series(1)
    ref = ds.to_json_dict(bulk_data_threshold=0, bulk_data_element_handler=lambda e: "x")
    ours = dataset_to_dicom_json(ds)
    for tag, v in ours.items():
        assert ref[tag]["vr"] == v["vr"]
        if v["vr"] not in ("DS", "IS") and "Value" in v:
            assert ref[tag]["Value"] == v["Value"], tag
