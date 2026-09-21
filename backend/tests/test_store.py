from pathlib import Path

import pydicom

from app.ingest.store import file_instance
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
