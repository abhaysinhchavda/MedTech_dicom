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
