from pathlib import Path

import pydicom
import pytest

from app.ingest.store import _ensure_within, file_instance
from tests.conftest import make_ct_series


def test_files_by_uid_hierarchy(tmp_path: Path) -> None:
    (ds,) = make_ct_series(1)
    p = file_instance(ds, tmp_path)
    assert p == tmp_path / ds.StudyInstanceUID / ds.SeriesInstanceUID / f"{ds.SOPInstanceUID}.dcm"
    assert pydicom.dcmread(p).SOPInstanceUID == ds.SOPInstanceUID


def test_overwrite_is_idempotent(tmp_path: Path) -> None:
    (ds,) = make_ct_series(1)
    p1 = file_instance(ds, tmp_path)
    p2 = file_instance(ds, tmp_path)
    assert p1 == p2 and len(list(p1.parent.iterdir())) == 1


def test_ensure_within_accepts_nested_path(tmp_path: Path) -> None:
    _ensure_within(tmp_path, tmp_path / "a" / "b" / "c.dcm")  # must not raise


def test_ensure_within_rejects_escape(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="escapes root"):
        _ensure_within(tmp_path / "store", tmp_path / "store" / ".." / ".." / "pwned")


def test_file_instance_rejects_path_escape(tmp_path: Path) -> None:
    # DICOM UI syntax (digits and dots only) can't actually encode "..", so a
    # legitimate read_dicom()-validated dataset can never reach this. This
    # exercises store.py's own containment check as defense in depth for any
    # other caller that builds a Dataset without going through the reader.
    (ds,) = make_ct_series(1)
    ds.StudyInstanceUID = "../../../../pwned"
    with pytest.raises(ValueError, match="escapes root"):
        file_instance(ds, tmp_path)
