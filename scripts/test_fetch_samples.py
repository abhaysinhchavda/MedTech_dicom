import sys
from pathlib import Path

import numpy as np
import pydicom
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from fetch_samples import _is_dicom_file, transcode_to_j2k, verify_series  # noqa: E402
from tests.conftest import make_ct_series, write_series  # noqa: E402


def test_is_dicom_file(tmp_path: Path) -> None:
    # A real (but non-`.dcm`-suffixed) archive member with no DICM magic must
    # not be mistaken for a DICOM instance.
    license_file = tmp_path / "LICENSE"
    license_file.write_text("MIT License\n")
    assert _is_dicom_file(license_file) is False

    # Some TCIA collections ship extensionless instances: 128-byte preamble
    # followed by the "DICM" magic at byte 128.
    extensionless = tmp_path / "IM000001"
    extensionless.write_bytes(b"\x00" * 128 + b"DICM")
    assert _is_dicom_file(extensionless) is True


def test_verify_series_ok_and_mismatch(tmp_path: Path) -> None:
    d = make_ct_series(3)
    write_series(d, tmp_path)
    verify_series(tmp_path, d[0].SeriesInstanceUID, 3)
    with pytest.raises(SystemExit):
        verify_series(tmp_path, d[0].SeriesInstanceUID, 4)
    with pytest.raises(SystemExit):
        verify_series(tmp_path, "9.9", 3)


def test_transcode_preserves_pixels(tmp_path: Path) -> None:
    (src,) = write_series(make_ct_series(1, rows=64, cols=64), tmp_path / "in")
    dst = tmp_path / "out" / "a.dcm"
    transcode_to_j2k(src, dst)
    a, b = pydicom.dcmread(src), pydicom.dcmread(dst)
    assert b.file_meta.TransferSyntaxUID == "1.2.840.10008.1.2.4.90"
    assert np.array_equal(a.pixel_array, b.pixel_array)
