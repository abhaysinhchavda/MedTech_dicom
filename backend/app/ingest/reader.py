from __future__ import annotations

from pathlib import Path

import pydicom
from pydicom.dataset import Dataset
from pydicom.errors import InvalidDicomError

REQUIRED = ("SOPInstanceUID", "SeriesInstanceUID", "StudyInstanceUID", "PixelData")


class NotDicomError(Exception):
    """File is not a DICOM image object we can serve."""


def read_dicom(path: Path) -> Dataset:
    try:
        ds = pydicom.dcmread(path, force=False)
    except (InvalidDicomError, OSError, ValueError) as e:
        raise NotDicomError(f"{path.name}: not a DICOM file ({e})") from e
    for tag in REQUIRED:
        if tag not in ds:
            raise NotDicomError(f"{path.name}: missing {tag}")
    return ds
