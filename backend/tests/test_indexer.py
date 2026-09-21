from pathlib import Path

import pydicom
from pydicom.uid import JPEG2000Lossless

from app import repo
from app.db import connect, init_schema
from app.ingest.indexer import finalize_series, ingest_directory
from tests.conftest import make_ct_series, write_series


def _conn(tmp_path: Path):
    c = connect(tmp_path / "idx.sqlite")
    init_schema(c)
    return c


def test_ingest_directory_indexes_and_finalizes(tmp_path: Path) -> None:
    c = _conn(tmp_path)
    dsets = make_ct_series(5)
    write_series(dsets, tmp_path / "in")
    summary = ingest_directory(c, tmp_path / "in", tmp_path / "store")
    assert summary.accepted == 5 and summary.skipped == [] and summary.study_uids == [
        dsets[0].StudyInstanceUID
    ]
    s = repo.get_series(c, dsets[0].SeriesInstanceUID)
    assert s.instance_count == 5 and s.sort_method == "geometry" and s.volume.is_volume
    assert s.volume.dims == (16, 16, 5) and s.thumb_sop_uid == dsets[2].SOPInstanceUID
    st = repo.get_study(c, dsets[0].StudyInstanceUID)
    assert st.patient_name == "Test^Patient" and st.modalities == ["CT"]
    stored = tmp_path / "store" / dsets[0].StudyInstanceUID / dsets[0].SeriesInstanceUID
    assert len(list(stored.glob("*.dcm"))) == 5


def test_reingest_is_idempotent(tmp_path: Path) -> None:
    c = _conn(tmp_path)
    write_series(make_ct_series(3), tmp_path / "in")
    ingest_directory(c, tmp_path / "in", tmp_path / "store")
    ingest_directory(c, tmp_path / "in", tmp_path / "store")
    (sid,) = [r[0] for r in c.execute("SELECT series_uid FROM series")]
    assert repo.get_series(c, sid).instance_count == 3


def test_non_dicom_and_sr_are_skipped_with_reason(tmp_path: Path) -> None:
    c = _conn(tmp_path)
    write_series(make_ct_series(3), tmp_path / "in")
    (tmp_path / "in" / "notes.txt").write_text("hi")
    (sr,) = make_ct_series(1)
    del sr.PixelData
    pydicom.dcmwrite(tmp_path / "in" / "sr.dcm", sr, enforce_file_format=True)
    summary = ingest_directory(c, tmp_path / "in", tmp_path / "store")
    assert summary.accepted == 3
    assert sorted(s.file for s in summary.skipped) == ["notes.txt", "sr.dcm"]
    assert all(s.reason for s in summary.skipped)


def test_compressed_input_is_stored_uncompressed(tmp_path: Path) -> None:
    c = _conn(tmp_path)
    write_series(
        make_ct_series(3, transfer_syntax=JPEG2000Lossless, rows=64, cols=64), tmp_path / "in"
    )
    summary = ingest_directory(c, tmp_path / "in", tmp_path / "store")
    assert summary.accepted == 3
    for p in (tmp_path / "store").rglob("*.dcm"):
        assert pydicom.dcmread(p).file_meta.TransferSyntaxUID == "1.2.840.10008.1.2.1"


def test_non_volume_series_is_indexed_with_reason(tmp_path: Path) -> None:
    c = _conn(tmp_path)
    write_series(make_ct_series(4, irregular=True), tmp_path / "in")
    ingest_directory(c, tmp_path / "in", tmp_path / "store")
    (sid,) = [r[0] for r in c.execute("SELECT series_uid FROM series")]
    s = finalize_series(c, sid)
    assert not s.volume.is_volume and s.volume.reason == "irregular slice spacing"
