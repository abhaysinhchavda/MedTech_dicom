from __future__ import annotations

from collections.abc import Sequence
from copy import deepcopy

from pydicom.dataset import Dataset

# highdicom reads these straight off the first source image to populate a
# derived object's Patient and General Study modules, for both Structured
# Reports and Segmentations. Anonymised and synthetic datasets routinely omit
# them, and the resulting AttributeError names the attribute but not the
# reason, so both writers fill the blanks here instead.
EVIDENCE_DEFAULTS = (
    "PatientID",
    "PatientName",
    "PatientBirthDate",
    "PatientSex",
    "StudyID",
    "AccessionNumber",
    "ReferringPhysicianName",
    "StudyDate",
    "StudyTime",
)


def prepared_source_images(datasets: Sequence[Dataset]) -> list[Dataset]:
    """Copies of `datasets` with the attributes highdicom demands present."""
    out: list[Dataset] = []
    for ds in datasets:
        # deepcopy: filling blanks must not mutate the caller's dataset, which
        # in the API layer is a freshly read source image.
        copy = deepcopy(ds)
        for tag in EVIDENCE_DEFAULTS:
            if tag not in copy:
                setattr(copy, tag, "")
        out.append(copy)
    return out
