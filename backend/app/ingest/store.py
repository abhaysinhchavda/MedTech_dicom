from __future__ import annotations

from pathlib import Path

import pydicom
from pydicom.dataset import Dataset


def file_instance(ds: Dataset, store_dir: Path) -> Path:
    dest = (
        store_dir
        / str(ds.StudyInstanceUID)
        / str(ds.SeriesInstanceUID)
        / f"{ds.SOPInstanceUID}.dcm"
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp")
    pydicom.dcmwrite(tmp, ds, enforce_file_format=True)
    tmp.replace(dest)
    return dest
