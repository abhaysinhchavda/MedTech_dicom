import numpy as np
import pytest
from pydicom.uid import ExplicitVRLittleEndian, JPEG2000Lossless, RLELossless

from app.ingest.decode import DecodeError, to_uncompressed
from tests.conftest import make_ct_series


@pytest.mark.parametrize("ts", [JPEG2000Lossless, RLELossless])
def test_compressed_roundtrips_to_explicit_le(ts: str) -> None:
    (ds,) = make_ct_series(1, transfer_syntax=ts, rows=64, cols=64)
    expected = ds.pixel_array.copy()
    assert ds.file_meta.TransferSyntaxUID.is_compressed
    out = to_uncompressed(ds)
    assert out.file_meta.TransferSyntaxUID == ExplicitVRLittleEndian
    assert not out.file_meta.TransferSyntaxUID.is_compressed
    assert np.array_equal(out.pixel_array, expected)
    assert len(out.PixelData) == 64 * 64 * 2


def test_uncompressed_passthrough() -> None:
    (ds,) = make_ct_series(1, rows=64, cols=64)
    raw = bytes(ds.PixelData)
    out = to_uncompressed(ds)
    assert out is ds and bytes(out.PixelData) == raw


def test_decode_failure_raises() -> None:
    (ds,) = make_ct_series(1, transfer_syntax=RLELossless, rows=64, cols=64)
    ds.PixelData = b"\x00" * 10  # corrupt encapsulated data
    with pytest.raises(DecodeError):
        to_uncompressed(ds)
