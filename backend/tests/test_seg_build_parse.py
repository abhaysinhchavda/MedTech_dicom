from __future__ import annotations

import numpy as np
import pytest
from pydicom.dataset import Dataset
from pydicom.uid import generate_uid

from app.segmentation import Segment
from app.segmentation.build import build_seg
from app.segmentation.parse import SegParseError, parse_seg
from tests.conftest import make_ct_series

SEGMENTATION_STORAGE = "1.2.840.10008.5.1.4.1.1.66.4"


def segments() -> list[Segment]:
    return [
        Segment(1, "Tumour", "2.25.101", "49755003", "372087000"),
        Segment(2, "Oedema", "2.25.102", "49755003", "372087000"),
    ]


def source_and_labels(n: int = 4, rows: int = 16, cols: int = 16):  # type: ignore[no-untyped-def]
    src = make_ct_series(n, rows=rows, cols=cols)
    labels = np.zeros((n, rows, cols), dtype=np.uint8)
    labels[1, 4:8, 4:8] = 1
    labels[2, 9:12, 2:5] = 2
    return src, labels


def build_one():  # type: ignore[no-untyped-def]
    src, labels = source_and_labels()
    ds = build_seg(
        labels,
        segments(),
        source_images=src,
        seg_series_uid=generate_uid(),
        seg_sop_uid=generate_uid(),
    )
    return src, labels, ds


def test_output_is_a_binary_segmentation() -> None:
    _, _, ds = build_one()
    assert ds.SOPClassUID == SEGMENTATION_STORAGE
    assert ds.Modality == "SEG"
    assert ds.SegmentationType == "BINARY"


def test_one_segment_sequence_item_per_segment() -> None:
    _, _, ds = build_one()
    assert len(ds.SegmentSequence) == 2
    assert [int(s.SegmentNumber) for s in ds.SegmentSequence] == [1, 2]
    assert [str(s.SegmentLabel) for s in ds.SegmentSequence] == ["Tumour", "Oedema"]


def test_tracking_uids_survive() -> None:
    _, _, ds = build_one()
    text = str(ds)
    assert "2.25.101" in text
    assert "2.25.102" in text


def test_empty_frames_are_omitted() -> None:
    # Two of four slices carry paint, so the object stores fewer frames than
    # slices times segments. This is what makes a small tumour in a 160-slice
    # series cheap to store.
    _, _, ds = build_one()
    assert int(ds.NumberOfFrames) < 4 * 2


def test_round_trip_returns_the_identical_label_volume() -> None:
    src, labels, ds = build_one()
    back, segs = parse_seg(ds, [str(s.SOPInstanceUID) for s in src])
    assert np.array_equal(back, labels)
    assert [s.number for s in segs] == [1, 2]
    assert [s.label for s in segs] == ["Tumour", "Oedema"]
    assert [s.tracking_uid for s in segs] == ["2.25.101", "2.25.102"]


def test_a_single_segment_round_trips() -> None:
    # highdicom takes a 3-D pixel array for one segment and 4-D for several,
    # so the single case exercises a different path inside the library.
    src = make_ct_series(4, rows=16, cols=16)
    labels = np.zeros((4, 16, 16), dtype=np.uint8)
    labels[2, 5:9, 5:9] = 1
    one = [Segment(1, "Tumour", "2.25.101", "49755003", "372087000")]
    ds = build_seg(
        labels,
        one,
        source_images=src,
        seg_series_uid=generate_uid(),
        seg_sop_uid=generate_uid(),
    )
    back, segs = parse_seg(ds, [str(s.SOPInstanceUID) for s in src])
    assert np.array_equal(back, labels)
    assert len(segs) == 1


def test_an_unsupported_category_code_is_rejected() -> None:
    src, labels = source_and_labels()
    bad = [Segment(1, "Tumour", "2.25.101", "99999999", "372087000")]
    with pytest.raises(ValueError, match="unsupported category code"):
        build_seg(
            labels,
            bad,
            source_images=src,
            seg_series_uid=generate_uid(),
            seg_sop_uid=generate_uid(),
        )


def test_a_dataset_that_is_not_a_segmentation_is_rejected() -> None:
    src: Dataset = make_ct_series(1)[0]
    with pytest.raises(SegParseError, match="not a Segmentation"):
        parse_seg(src, [str(src.SOPInstanceUID)])
