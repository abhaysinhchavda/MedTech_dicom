from __future__ import annotations

from collections.abc import Sequence

import highdicom as hd
import numpy as np
from pydicom.dataset import Dataset
from pydicom.sr.codedict import codes
from pydicom.sr.coding import Code

from app.segmentation.mask import split_segments
from app.segmentation.models import Segment
from app.source_images import prepared_source_images

# Verified against pydicom's dictionary. The naive guess for the type code
# (86049000) does not exist; NeoplasmPrimary is 372087000. This is the third
# coded concept in this project where the obvious guess was wrong.
CATEGORY_CODES: dict[str, Code] = {
    "49755003": codes.SCT.MorphologicallyAbnormalStructure,
}
TYPE_CODES: dict[str, Code] = {
    "372087000": codes.SCT.NeoplasmPrimary,
    "108369006": codes.SCT.Neoplasm,
}

MANUFACTURER = "DICOM 3D Brain Viewer"
MODEL_NAME = "dicom-3d-brain-viewer"
SOFTWARE_VERSION = "1.0"
DEVICE_SERIAL = "1"


def _coded(table: dict[str, Code], value: str, what: str) -> Code:
    try:
        return table[value]
    except KeyError as e:
        raise ValueError(f"unsupported {what} code {value!r}") from e


def _descriptions(segments: Sequence[Segment]) -> list[hd.seg.SegmentDescription]:
    return [
        hd.seg.SegmentDescription(
            segment_number=s.number,
            segment_label=s.label,
            segmented_property_category=_coded(CATEGORY_CODES, s.category_code, "category"),
            segmented_property_type=_coded(TYPE_CODES, s.type_code, "type"),
            # The mask came from a person's hand, so MANUAL is the honest value.
            algorithm_type=hd.seg.SegmentAlgorithmTypeValues.MANUAL,
            tracking_uid=s.tracking_uid,
            tracking_id=s.label,
        )
        for s in segments
    ]


def build_seg(
    labels: np.ndarray,
    segments: Sequence[Segment],
    *,
    source_images: Sequence[Dataset],
    seg_series_uid: str,
    seg_sop_uid: str,
    series_number: int = 98,
    instance_number: int = 1,
) -> Dataset:
    planes = split_segments(labels, segments)
    # highdicom takes (frames, rows, cols) for a single segment and
    # (frames, rows, cols, segments) for several, so the segment axis moves
    # last and collapses when there is only one. Both shapes were confirmed
    # against the library rather than inferred from its documentation.
    pixel_array = np.moveaxis(planes, 0, -1).astype(np.uint8)
    if pixel_array.shape[-1] == 1:
        pixel_array = pixel_array[..., 0]
    return hd.seg.Segmentation(
        source_images=prepared_source_images(source_images),
        pixel_array=pixel_array,
        segmentation_type=hd.seg.SegmentationTypeValues.BINARY,
        segment_descriptions=_descriptions(segments),
        series_instance_uid=seg_series_uid,
        series_number=series_number,
        sop_instance_uid=seg_sop_uid,
        instance_number=instance_number,
        # omit_empty_frames stays at its default True: a small tumour in a
        # 160-slice volume would otherwise store 160 frames of mostly zeros.
        # The read side compensates with assert_missing_frames_are_empty.
        #
        # Spelled out rather than splatted from a dict: mypy --strict cannot
        # narrow a dict[str, str] onto these four distinct parameter types.
        manufacturer=MANUFACTURER,
        manufacturer_model_name=MODEL_NAME,
        software_versions=SOFTWARE_VERSION,
        device_serial_number=DEVICE_SERIAL,
    )
