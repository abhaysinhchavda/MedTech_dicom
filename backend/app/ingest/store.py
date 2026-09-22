from __future__ import annotations

from pathlib import Path

import pydicom
from pydicom.dataset import Dataset


def _ensure_within(root: Path, target: Path) -> None:
    """Raise ValueError if `target` would resolve outside of `root`.

    Defense in depth against path traversal: even though callers are expected
    to have already validated the DICOM UIDs that feed into `target`, this is
    the last line of defense before anything is written to (or read from)
    disk under `root`.
    """
    root_r = root.resolve()
    target_r = target.resolve()
    if not target_r.is_relative_to(root_r):
        raise ValueError(f"path {target_r} escapes root {root_r}")


def file_instance(ds: Dataset, store_dir: Path) -> Path:
    dest = (
        store_dir
        / str(ds.StudyInstanceUID)
        / str(ds.SeriesInstanceUID)
        / f"{ds.SOPInstanceUID}.dcm"
    )
    _ensure_within(store_dir, dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(".tmp")
    pydicom.dcmwrite(tmp, ds, enforce_file_format=True)
    tmp.replace(dest)
    return dest
