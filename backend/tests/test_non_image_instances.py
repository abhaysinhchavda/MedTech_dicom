from __future__ import annotations

import sqlite3
from pathlib import Path

import pydicom
import pytest
from fastapi.testclient import TestClient
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

from app import repo
from app.config import Settings
from app.db import connect, init_schema
from app.ingest.indexer import ingest_files
from app.ingest.reader import NotDicomError, read_dicom

COMPREHENSIVE_3D_SR = "1.2.840.10008.5.1.4.1.1.88.34"


def make_sr(tmp_path: Path, study_uid: str, series_uid: str) -> Path:
    """A minimal SR: no PixelData, no Rows/Columns, but a ContentSequence."""
    ds = Dataset()
    ds.SOPClassUID = COMPREHENSIVE_3D_SR
    ds.SOPInstanceUID = generate_uid()
    ds.SeriesInstanceUID = series_uid
    ds.StudyInstanceUID = study_uid
    ds.Modality = "SR"
    ds.SeriesNumber = 99
    ds.InstanceNumber = 1
    item = Dataset()
    item.RelationshipType = "CONTAINS"
    item.ValueType = "TEXT"
    item.TextValue = "placeholder"
    ds.ContentSequence = [item]
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = ds.SOPClassUID
    ds.file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
    path = tmp_path / "sr.dcm"
    pydicom.dcmwrite(path, ds, enforce_file_format=True)
    return path


def test_read_dicom_accepts_sr_without_pixeldata(tmp_path: Path) -> None:
    path = make_sr(tmp_path, generate_uid(), generate_uid())
    ds = read_dicom(path)
    assert ds.Modality == "SR"


def test_read_dicom_still_rejects_an_image_without_pixeldata(tmp_path: Path) -> None:
    ds = Dataset()
    ds.SOPClassUID = "1.2.840.10008.5.1.4.1.1.2"  # CT Image Storage
    ds.SOPInstanceUID = generate_uid()
    ds.SeriesInstanceUID = generate_uid()
    ds.StudyInstanceUID = generate_uid()
    ds.file_meta = FileMetaDataset()
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    ds.file_meta.MediaStorageSOPClassUID = ds.SOPClassUID
    ds.file_meta.MediaStorageSOPInstanceUID = ds.SOPInstanceUID
    path = tmp_path / "broken.dcm"
    pydicom.dcmwrite(path, ds, enforce_file_format=True)
    with pytest.raises(NotDicomError, match="PixelData"):
        read_dicom(path)


def test_sr_is_ingested_into_its_own_series(tmp_path: Path, settings: Settings) -> None:
    conn = connect(settings.db_path)
    init_schema(conn)
    study_uid, series_uid = generate_uid(), generate_uid()
    path = make_sr(tmp_path, study_uid, series_uid)

    summary = ingest_files(conn, [path], settings.store_dir)

    assert summary.accepted == 1
    assert summary.skipped == []
    series = repo.get_series(conn, series_uid)
    assert series is not None
    assert series.modality == "SR"
    assert series.volume.is_volume is False
    assert series.volume.reason == "structured report, not an image series"
    assert series.thumb_sop_uid is None
    inst = repo.list_instances(conn, series_uid)[0]
    assert inst.sop_class_uid == COMPREHENSIVE_3D_SR
    assert inst.rows is None
    assert inst.bits_allocated is None
    conn.close()


def test_migration_adds_columns_to_an_existing_database(tmp_path: Path) -> None:
    db = tmp_path / "old.sqlite"
    conn = sqlite3.connect(db)
    conn.executescript(
        """CREATE TABLE instance (sop_uid TEXT PRIMARY KEY, series_uid TEXT, path TEXT);
           CREATE TABLE series (series_uid TEXT PRIMARY KEY, study_uid TEXT);
           INSERT INTO instance VALUES ('1.2', '1.3', 'p');"""
    )
    conn.commit()
    conn.close()

    conn = connect(db)
    init_schema(conn)
    cols_i = {r[1] for r in conn.execute("PRAGMA table_info(instance)")}
    cols_s = {r[1] for r in conn.execute("PRAGMA table_info(series)")}
    assert "sop_class_uid" in cols_i
    assert "derived_from_series_uid" in cols_s
    assert conn.execute("SELECT COUNT(*) FROM instance").fetchone()[0] == 1
    init_schema(conn)  # idempotent
    conn.close()


def test_volume_info_does_not_crash_for_a_non_image_series(
    client: TestClient, tmp_path: Path
) -> None:
    study_uid, series_uid = generate_uid(), generate_uid()
    path = make_sr(tmp_path, study_uid, series_uid)
    ingest_files(client.app.state.db, [path], client.app.state.settings.store_dir)

    r = client.get(f"/api/series/{series_uid}/volume-info")

    assert r.status_code == 200
    assert r.json()["isVolume"] is False
    assert r.json()["estimatedBytes"] is None
