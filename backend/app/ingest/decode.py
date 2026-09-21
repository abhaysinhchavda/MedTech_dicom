from __future__ import annotations

from pydicom.dataset import Dataset
from pydicom.uid import ExplicitVRLittleEndian


class DecodeError(Exception):
    """Pixel data could not be decoded to native little-endian."""


def to_uncompressed(ds: Dataset) -> Dataset:
    ts = ds.file_meta.TransferSyntaxUID
    if not ts.is_compressed:
        if ts != ExplicitVRLittleEndian:
            ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
        return ds
    try:
        ds.decompress(generate_instance_uid=False)
    except Exception as e:  # pylibjpeg raises a zoo of exception types
        raise DecodeError(f"cannot decode transfer syntax {ts.name}: {e}") from e
    ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
    return ds
