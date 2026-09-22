import sys
from pathlib import Path

import numpy as np
import pydicom
import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from fetch_samples import transcode_to_j2k, verify_series  # noqa: E402

from tests.conftest import make_ct_series, write_series  # noqa: E402


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
