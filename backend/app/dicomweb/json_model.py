from __future__ import annotations

import base64
from typing import Any

from pydicom.dataelem import DataElement
from pydicom.dataset import Dataset
from pydicom.multival import MultiValue
from pydicom.valuerep import PersonName

BULK_VRS = {"OB", "OW", "OF", "OD", "OL", "OV", "UN"}
FLOAT_VRS = {"FL", "FD", "DS"}
INT_VRS = {"IS", "SL", "SS", "UL", "US", "SV", "UV"}

_AMBIGUOUS_MARKER = " or "


def _resolve_vr(vr: str, el: DataElement, ds: Dataset) -> str:
    """Resolve a pydicom-internal ambiguous VR placeholder (e.g. ``"OB or OW"``)
    to the concrete VR the DICOM standard and the JSON model require.

    pydicom only leaves a VR ambiguous for datasets built in memory that were
    never round-tripped through read/write -- Explicit VR Little Endian
    encodes a concrete VR per element on disk, so a dataset produced by
    ``dcmread`` never hits this path. ``"OB or OW"`` is not a valid DICOM VR,
    so it must never leak into our output.
    """
    if _AMBIGUOUS_MARKER not in vr:
        return vr
    if el.tag == 0x7FE00010:  # Pixel Data (PS3.5 Annex A.2)
        if el.is_undefined_length:
            return "OB"  # encapsulated (compressed) pixel data
        bits_allocated = getattr(ds, "BitsAllocated", None)
        if bits_allocated is not None and int(bits_allocated) > 8:
            return "OW"
        return "OB"
    # Best-effort fallback for other ambiguous VRs (e.g. "US or SS"):
    # keep pydicom's first-listed alternative.
    return vr.split(_AMBIGUOUS_MARKER)[0].strip()


def _values(el: DataElement, vr: str) -> list[Any]:
    """Build the JSON ``Value`` array for `el`, typed by its resolved `vr`.

    `vr` (not `el.VR`) drives the branching so an ambiguous VR that
    :func:`_resolve_vr` has already resolved (e.g. "US or SS" -> "US") is
    typed consistently between the emitted ``"vr"`` key and ``"Value"``.
    """
    raw = el.value
    items = list(raw) if isinstance(raw, MultiValue | list | tuple) else [raw]
    out: list[Any] = []
    for v in items:
        if v is None or v == "":
            continue
        if vr == "PN":
            pn = v if isinstance(v, PersonName) else PersonName(v)
            comps: dict[str, str] = {"Alphabetic": pn.components[0]}
            if len(pn.components) > 1 and pn.components[1]:
                comps["Ideographic"] = pn.components[1]
            if len(pn.components) > 2 and pn.components[2]:
                comps["Phonetic"] = pn.components[2]
            out.append(comps)
        elif vr in FLOAT_VRS:
            out.append(float(v))
        elif vr in INT_VRS:
            out.append(int(v))
        elif vr == "AT":
            out.append(f"{int(v):08X}")
        else:
            out.append(str(v))
    return out


def dataset_to_dicom_json(ds: Dataset, *, include_bulk: bool = False) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for el in ds:
        tag = f"{el.tag.group:04X}{el.tag.element:04X}"
        vr = _resolve_vr(str(el.VR), el, ds)
        if vr in BULK_VRS:
            if not include_bulk:
                continue
            out[tag] = {"vr": vr, "InlineBinary": base64.b64encode(bytes(el.value)).decode()}
            continue
        if vr == "SQ":
            items = [
                dataset_to_dicom_json(item, include_bulk=include_bulk) for item in el.value
            ]
            out[tag] = {"vr": vr, "Value": items}
            continue
        if el.is_empty:
            out[tag] = {"vr": vr}
            continue
        vals = _values(el, vr)
        out[tag] = {"vr": vr, "Value": vals} if vals else {"vr": vr}
    return out
