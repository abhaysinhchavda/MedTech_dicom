from __future__ import annotations

import json
import sqlite3
from pathlib import Path
from typing import Any

import numpy as np
import pydicom
from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from pydicom.dataset import Dataset
from pydicom.uid import generate_uid

from app import repo
from app.config import Settings
from app.dicomweb.deps import get_db, get_settings_dep
from app.geometry import sort_instances
from app.ingest.indexer import finalize_series, index_instance
from app.ingest.store import file_instance
from app.models import InstanceRow, SeriesRow
from app.segmentation import Dims, Segment
from app.segmentation.build import build_seg
from app.segmentation.mask import labels_from_bytes, labels_to_bytes
from app.segmentation.parse import SegParseError, parse_seg
from app.segmentation.validate import SegValidationError, validate_set

router = APIRouter(prefix="/api", tags=["segmentation"])
SEG_MODALITY = "SEG"


def _ordered_instances(conn: sqlite3.Connection, series_uid: str) -> list[InstanceRow]:
    """The reference series' instances in the volume's own slice order.

    parse_seg maps the SEG's frames onto this order, so it must be the same
    ordering the volume itself uses, not insertion order.
    """
    ordered, _ = sort_instances(repo.list_instances(conn, series_uid))
    return ordered


def _frame_of_reference(instances: list[InstanceRow]) -> str | None:
    for inst in instances:
        ds = pydicom.dcmread(inst.path, stop_before_pixels=True)
        for_uid = str(ds.get("FrameOfReferenceUID", "")) or None
        if for_uid:
            return for_uid
    return None


def _current_seg(
    conn: sqlite3.Connection, series_uid: str
) -> tuple[SeriesRow | None, InstanceRow | None]:
    series = repo.find_derived_series(conn, series_uid, SEG_MODALITY)
    if series is None:
        return None, None
    instances = repo.list_instances(conn, series.series_uid)
    if not instances:
        return series, None
    # Newest wins, exactly as for the report: a crash between writing the new
    # object and deleting the old leaves two, and the newer one is the truth.
    newest = max(instances, key=lambda i: (i.instance_number or 0, i.sop_uid))
    return series, newest


def _segment_to_json(s: Segment) -> dict[str, Any]:
    return {
        "number": s.number,
        "label": s.label,
        "trackingUid": s.tracking_uid,
        "categoryCode": s.category_code,
        "typeCode": s.type_code,
    }


def _segment_from_json(raw: dict[str, Any]) -> Segment:
    try:
        return Segment(
            number=int(raw["number"]),
            label=str(raw["label"]),
            tracking_uid=str(raw["trackingUid"]),
            category_code=str(raw["categoryCode"]),
            type_code=str(raw["typeCode"]),
        )
    except (KeyError, TypeError, ValueError) as e:
        raise HTTPException(422, f"malformed segment: {e}") from e


def _envelope(
    series_uid: str,
    for_uid: str | None,
    dims: Dims | None,
    seg_series_uid: str | None,
    seg_sop_uid: str | None,
    segments: list[Segment],
    parse_error: str | None,
) -> dict[str, Any]:
    return {
        "seriesUid": series_uid,
        "frameOfReferenceUid": for_uid,
        "dims": list(dims) if dims else None,
        "segSeriesUid": seg_series_uid,
        "segSopUid": seg_sop_uid,
        "parseError": parse_error,
        "segments": [_segment_to_json(s) for s in segments],
    }


def _series_dims(conn: sqlite3.Connection, series_uid: str) -> Dims:
    series = repo.get_series(conn, series_uid)
    if series is None:
        raise HTTPException(404, f"series {series_uid} not found")
    if not series.volume.dims:
        raise HTTPException(422, f"series {series_uid} is not a volume, so it cannot be segmented")
    return series.volume.dims


def _load(conn: sqlite3.Connection, series_uid: str) -> tuple[np.ndarray, list[Segment]] | None:
    """The stored label volume and its segments, or None when there is none."""
    seg_series, newest = _current_seg(conn, series_uid)
    if seg_series is None or newest is None:
        return None
    ordered = _ordered_instances(conn, series_uid)
    return parse_seg(pydicom.dcmread(newest.path), [i.sop_uid for i in ordered])


@router.get("/series/{series_uid}/segmentation")
def get_segmentation(
    series_uid: str, conn: sqlite3.Connection = Depends(get_db)
) -> dict[str, Any]:
    series = repo.get_series(conn, series_uid)
    if series is None:
        raise HTTPException(404, f"series {series_uid} not found")
    dims = series.volume.dims
    for_uid = _frame_of_reference(_ordered_instances(conn, series_uid))
    seg_series, newest = _current_seg(conn, series_uid)
    if seg_series is None or newest is None:
        return _envelope(series_uid, for_uid, dims, None, None, [], None)
    try:
        loaded = _load(conn, series_uid)
    except (SegParseError, AttributeError, KeyError, ValueError, OSError) as e:
        # A segmentation we cannot read must never stop the series opening.
        return _envelope(
            series_uid,
            for_uid,
            dims,
            seg_series.series_uid,
            newest.sop_uid,
            [],
            f"{type(e).__name__}: {e}",
        )
    assert loaded is not None
    return _envelope(
        series_uid, for_uid, dims, seg_series.series_uid, newest.sop_uid, loaded[1], None
    )


@router.get("/series/{series_uid}/segmentation/labelmap")
def get_labelmap(series_uid: str, conn: sqlite3.Connection = Depends(get_db)) -> Response:
    if repo.get_series(conn, series_uid) is None:
        raise HTTPException(404, f"series {series_uid} not found")
    try:
        loaded = _load(conn, series_uid)
    except (SegParseError, AttributeError, KeyError, ValueError, OSError) as e:
        raise HTTPException(404, f"segmentation cannot be read: {e}") from e
    if loaded is None:
        raise HTTPException(404, f"series {series_uid} has no segmentation")
    raw = labels_to_bytes(loaded[0])
    return Response(
        raw,
        media_type="application/octet-stream",
        headers={"Content-Length": str(len(raw))},
    )


def _delete_previous(conn: sqlite3.Connection, previous: InstanceRow | None) -> None:
    if previous is None:
        return
    Path(previous.path).unlink(missing_ok=True)
    with conn:
        repo.delete_instance(conn, previous.sop_uid)


@router.put("/series/{series_uid}/segmentation")
async def put_segmentation(
    series_uid: str,
    meta: str = Form(...),
    labelmap: UploadFile = File(...),
    conn: sqlite3.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> dict[str, Any]:
    series_dims = _series_dims(conn, series_uid)
    instances = _ordered_instances(conn, series_uid)
    if not instances:
        raise HTTPException(404, f"series {series_uid} has no instances")
    for_uid = _frame_of_reference(instances)

    try:
        payload: dict[str, Any] = json.loads(meta)
    except json.JSONDecodeError as e:
        raise HTTPException(422, f"meta is not valid JSON: {e}") from e
    raw_dims = payload.get("dims") or []
    if len(raw_dims) != 3:
        raise HTTPException(422, "meta.dims must be three integers")
    dims: Dims = (int(raw_dims[0]), int(raw_dims[1]), int(raw_dims[2]))
    segments = [_segment_from_json(s) for s in payload.get("segments", [])]

    raw = await labelmap.read()
    try:
        labels = labels_from_bytes(raw, dims)
        validate_set(labels, segments, dims=dims, series_dims=series_dims)
    except (ValueError, SegValidationError) as e:
        raise HTTPException(422, str(e)) from e

    seg_series, previous = _current_seg(conn, series_uid)
    sent = payload.get("segSopUid")
    current = previous.sop_uid if previous else None
    if sent != current:
        raise HTTPException(
            409,
            f"segmentation changed since it was loaded (expected {current!r}, got {sent!r})",
        )

    if not labels.any():
        # Erasing everything is a legitimate action. Writing an object with no
        # positive voxels would be a degenerate SEG, so remove it instead and
        # leave the store clean.
        _delete_previous(conn, previous)
        if seg_series is not None:
            finalize_series(conn, seg_series.series_uid)
        return _envelope(series_uid, for_uid, series_dims, None, None, [], None)

    seg_series_uid = seg_series.series_uid if seg_series else generate_uid()
    sop_uid = generate_uid()
    source: list[Dataset] = [pydicom.dcmread(i.path) for i in instances]
    ds = build_seg(
        labels,
        segments,
        source_images=source,
        seg_series_uid=seg_series_uid,
        seg_sop_uid=sop_uid,
        instance_number=(previous.instance_number or 0) + 1 if previous else 1,
    )

    # Write the new object, index it, and only then drop the old one. The
    # reverse order can lose the only copy.
    dest = file_instance(ds, settings.store_dir)
    index_instance(conn, ds, dest)
    with conn:
        repo.set_derived_from(conn, seg_series_uid, series_uid)
    _delete_previous(conn, previous)
    finalize_series(conn, seg_series_uid)

    return _envelope(series_uid, for_uid, series_dims, seg_series_uid, sop_uid, segments, None)
