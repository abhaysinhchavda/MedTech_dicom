from pathlib import Path

import pydicom
import pytest

from app.ingest.reader import NotDicomError, read_dicom
from tests.conftest import make_ct_series, write_series


def test_reads_valid_file(tmp_path: Path) -> None:
    (p,) = write_series(make_ct_series(1), tmp_path)
    ds = read_dicom(p)
    assert ds.SOPInstanceUID and ds.pixel_array.shape == (16, 16)


def test_rejects_non_dicom(tmp_path: Path) -> None:
    p = tmp_path / "junk.txt"
    p.write_bytes(b"hello world" * 100)
    with pytest.raises(NotDicomError):
        read_dicom(p)


def test_rejects_object_without_pixel_data(tmp_path: Path) -> None:
    (ds,) = make_ct_series(1)
    del ds.PixelData
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.88.11"  # Basic Text SR
    p = tmp_path / "sr.dcm"
    pydicom.dcmwrite(p, ds, enforce_file_format=True)
    with pytest.raises(NotDicomError, match="PixelData"):
        read_dicom(p)


def test_rejects_path_traversal_uid(tmp_path: Path) -> None:
    # pydicom only *warns* on a malformed UI value (it doesn't raise), so
    # without explicit validation this would sail through read_dicom and later
    # get joined straight into a store path by app.ingest.store.file_instance.
    # pydicom warns twice for a value like this: once when the attribute is
    # assigned, and again when dcmread lazily converts+validates the raw bytes
    # on first access -- read_dicom's own UID_TAGS check is what triggers that
    # second one. Both pytest.warns below document (and assert) that pydicom
    # does in fact consider this value invalid; that's expected fixture noise,
    # not product noise, and asserting it keeps `pytest -q` warning-free.
    (ds,) = make_ct_series(1)
    with pytest.warns(UserWarning, match="Invalid value for VR UI"):
        ds.StudyInstanceUID = "../../../../pwned"
    p = tmp_path / "traversal.dcm"
    pydicom.dcmwrite(p, ds, enforce_file_format=True)
    with (
        pytest.warns(UserWarning, match="Invalid value for VR UI"),
        pytest.raises(NotDicomError, match="StudyInstanceUID"),
    ):
        read_dicom(p)


def test_rejects_overlong_uid(tmp_path: Path) -> None:
    (ds,) = make_ct_series(1)
    with pytest.warns(UserWarning, match="exceeds the maximum length"):
        ds.SeriesInstanceUID = "1." * 32 + "1"  # 65 characters, over the 64-char UI limit
    p = tmp_path / "overlong.dcm"
    pydicom.dcmwrite(p, ds, enforce_file_format=True)
    with (
        pytest.warns(UserWarning, match="exceeds the maximum length"),
        pytest.raises(NotDicomError, match="SeriesInstanceUID"),
    ):
        read_dicom(p)


def test_rejects_uid_with_letters(tmp_path: Path) -> None:
    (ds,) = make_ct_series(1)
    with pytest.warns(UserWarning, match="Invalid value for VR UI"):
        ds.SOPInstanceUID = "1.2.abc"
    p = tmp_path / "letters.dcm"
    # Unlike Study/SeriesInstanceUID, dcmwrite(enforce_file_format=True) also
    # mirrors SOPInstanceUID into file_meta.MediaStorageSOPInstanceUID, which
    # revalidates (and re-warns on) the same invalid value a second time here.
    with pytest.warns(UserWarning, match="Invalid value for VR UI"):
        pydicom.dcmwrite(p, ds, enforce_file_format=True)
    with (
        pytest.warns(UserWarning, match="Invalid value for VR UI"),
        pytest.raises(NotDicomError, match="SOPInstanceUID"),
    ):
        read_dicom(p)
