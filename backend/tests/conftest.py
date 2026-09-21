from __future__ import annotations

from pathlib import Path

import numpy as np
import pydicom
import pytest
from fastapi.testclient import TestClient
from pydicom.dataset import Dataset, FileMetaDataset
from pydicom.uid import ExplicitVRLittleEndian, generate_uid

from app.config import Settings
from app.main import create_app


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        store_dir=tmp_path / "store",
        samples_dir=tmp_path / "samples",
        db_path=tmp_path / "store" / "index.sqlite",
        max_upload_mb=5,
        cors_origins=["http://localhost:5173"],
    )


@pytest.fixture
def client(settings: Settings) -> TestClient:
    settings.samples_dir.mkdir(parents=True, exist_ok=True)
    return TestClient(create_app(settings))


ORIENTATIONS = {
    "axial": [1, 0, 0, 0, 1, 0],
    "coronal": [1, 0, 0, 0, 0, -1],
    "sagittal": [0, 1, 0, 0, 0, -1],
}


def make_ct_series(
    n: int,
    *,
    spacing: tuple[float, float, float] = (0.5, 0.5, 1.0),
    orientation: str = "axial",
    transfer_syntax: str = ExplicitVRLittleEndian,
    irregular: bool = False,
    mixed_orientation: bool = False,
    rows: int = 16,
    cols: int = 16,
    study_uid: str | None = None,
    series_uid: str | None = None,
    modality: str = "CT",
) -> list[Dataset]:
    study_uid = study_uid or generate_uid()
    series_uid = series_uid or generate_uid()
    iop = ORIENTATIONS[orientation]
    normal = np.cross(iop[:3], iop[3:])
    out: list[Dataset] = []
    for i in range(n):
        ds = Dataset()
        ds.file_meta = FileMetaDataset()
        ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
        ds.file_meta.MediaStorageSOPClassUID = "1.2.840.10008.5.1.4.1.1.2"
        ds.file_meta.MediaStorageSOPInstanceUID = generate_uid()
        ds.SOPClassUID = ds.file_meta.MediaStorageSOPClassUID
        ds.SOPInstanceUID = ds.file_meta.MediaStorageSOPInstanceUID
        ds.StudyInstanceUID = study_uid
        ds.SeriesInstanceUID = series_uid
        ds.PatientName = "Test^Patient"
        ds.PatientID = "P001"
        ds.StudyDate = "20240101"
        ds.StudyTime = "120000"
        ds.StudyDescription = "Synthetic study"
        ds.SeriesDescription = "Synthetic series"
        ds.AccessionNumber = "ACC1"
        ds.Modality = modality
        ds.SeriesNumber = 1
        ds.InstanceNumber = i + 1
        ds.Rows, ds.Columns = rows, cols
        ds.SamplesPerPixel = 1
        ds.PhotometricInterpretation = "MONOCHROME2"
        ds.BitsAllocated, ds.BitsStored, ds.HighBit = 16, 16, 15
        ds.PixelRepresentation = 1
        ds.RescaleIntercept, ds.RescaleSlope = -1024, 1
        ds.WindowCenter, ds.WindowWidth = 40, 400
        ds.PixelSpacing = [spacing[0], spacing[1]]
        ds.SliceThickness = spacing[2]
        z = i * spacing[2] + (spacing[2] * 0.5 if irregular and i == n // 2 else 0.0)
        ds.ImagePositionPatient = [float(v) for v in normal * z]
        ds.ImageOrientationPatient = (
            ORIENTATIONS["coronal"] if mixed_orientation and i == n - 1 else iop
        )
        rng = np.random.default_rng(i)
        ds.PixelData = rng.integers(-1000, 2000, size=(rows, cols), dtype=np.int16).tobytes()
        if transfer_syntax != ExplicitVRLittleEndian:
            ds.compress(transfer_syntax)
        out.append(ds)
    return out


def write_series(datasets: list[Dataset], directory: Path) -> list[Path]:
    directory.mkdir(parents=True, exist_ok=True)
    paths = []
    for k, ds in enumerate(datasets):
        p = directory / f"img{k:04d}.dcm"
        pydicom.dcmwrite(p, ds, enforce_file_format=True)
        paths.append(p)
    return paths
