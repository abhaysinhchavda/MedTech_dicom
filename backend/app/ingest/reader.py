from __future__ import annotations

import re
from pathlib import Path

import pydicom
from pydicom.dataset import Dataset
from pydicom.errors import InvalidDicomError

# Comprehensive SR, Enhanced SR, Comprehensive 3D SR. These carry a
# ContentSequence instead of PixelData, so the image required-tag set below
# would reject every one of them.
SR_SOP_CLASSES = frozenset(
    {
        "1.2.840.10008.5.1.4.1.1.88.11",
        "1.2.840.10008.5.1.4.1.1.88.22",
        "1.2.840.10008.5.1.4.1.1.88.34",
    }
)
_UIDS = ("SOPInstanceUID", "SeriesInstanceUID", "StudyInstanceUID")
REQUIRED_IMAGE = (*_UIDS, "PixelData")
REQUIRED_SR = (*_UIDS, "ContentSequence")

# The three UIDs that become path segments in app.ingest.store.file_instance.
# pydicom only *warns* on malformed UI values (it does not raise), so a crafted
# UID such as "../../../../pwned" would otherwise sail through read_dicom and
# later be joined straight into a filesystem path. DICOM UI syntax is a
# dot-separated run of digit groups, max 64 characters (PS3.5 6.2).
UID_TAGS = ("StudyInstanceUID", "SeriesInstanceUID", "SOPInstanceUID")
_UID_RE = re.compile(r"^[0-9]+(\.[0-9]+)*$")
_UID_MAX_LEN = 64


class NotDicomError(Exception):
    """File is not a DICOM image object we can serve."""


def read_dicom(path: Path) -> Dataset:
    try:
        ds = pydicom.dcmread(path, force=False)
    except (InvalidDicomError, OSError, ValueError) as e:
        raise NotDicomError(f"{path.name}: not a DICOM file ({e})") from e
    is_sr = str(ds.get("SOPClassUID", "")) in SR_SOP_CLASSES
    for tag in REQUIRED_SR if is_sr else REQUIRED_IMAGE:
        if tag not in ds:
            raise NotDicomError(f"{path.name}: missing {tag}")
    for tag in UID_TAGS:
        value = str(getattr(ds, tag))
        if len(value) > _UID_MAX_LEN or not _UID_RE.match(value):
            raise NotDicomError(f"{path.name}: invalid {tag} value {value!r}")
    return ds
