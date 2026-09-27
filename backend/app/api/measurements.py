from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Any

import pydicom
from fastapi import APIRouter, Body, Depends, HTTPException
from pydicom.dataset import Dataset
from pydicom.uid import generate_uid

from app import repo
from app.config import Settings
from app.dicomweb.deps import get_db, get_settings_dep
from app.ingest.indexer import finalize_series, index_instance
from app.ingest.store import file_instance
from app.models import InstanceRow, SeriesRow
from app.sr import MeasurementItem, MeasurementValue, Plane, SrParseError, build_sr, parse_sr
from app.sr.validate import SrValidationError, derive_values, validate_set

router = APIRouter(prefix="/api", tags=["measurements"])
SR_MODALITY = "SR"


def _frame_of_reference(conn: sqlite3.Connection, series_uid: str) -> str | None:
    for inst in repo.list_instances(conn, series_uid):
        ds = pydicom.dcmread(inst.path, stop_before_pixels=True)
        for_uid = str(ds.get("FrameOfReferenceUID", "")) or None
        if for_uid:
            return for_uid
    return None


def _current_sr(
    conn: sqlite3.Connection, series_uid: str
) -> tuple[SeriesRow | None, InstanceRow | None]:
    series = repo.find_derived_series(conn, series_uid, SR_MODALITY)
    if series is None:
        return None, None
    instances = repo.list_instances(conn, series.series_uid)
    if not instances:
        return series, None
    # Newest wins. A crash between "write the new report" and "delete the old"
    # leaves two, and the newer one is the truth.
    newest = max(instances, key=lambda i: (i.instance_number or 0, i.sop_uid))
    return series, newest


def _item_to_json(m: MeasurementItem) -> dict[str, Any]:
    return {
        "id": m.id,
        "tool": m.tool,
        "points": [list(p) for p in m.points],
        "plane": {"normal": list(m.plane.normal), "up": list(m.plane.up)},
        "values": [{"name": v.name, "value": v.value, "unit": v.unit} for v in m.values],
        "label": m.label,
    }


def _item_from_json(raw: dict[str, Any]) -> MeasurementItem:
    try:
        return MeasurementItem(
            id=str(raw["id"]),
            tool=str(raw["tool"]),
            points=[(float(p[0]), float(p[1]), float(p[2])) for p in raw["points"]],
            plane=Plane(
                normal=tuple(float(c) for c in raw["plane"]["normal"]),  # type: ignore[arg-type]
                up=tuple(float(c) for c in raw["plane"]["up"]),  # type: ignore[arg-type]
            ),
            values=[
                MeasurementValue(str(v["name"]), float(v["value"]), str(v["unit"]))
                for v in raw["values"]
            ],
            label=raw.get("label") or None,
        )
    except (KeyError, TypeError, ValueError, IndexError) as e:
        raise HTTPException(422, f"malformed measurement: {e}") from e


def _envelope(
    series_uid: str,
    for_uid: str | None,
    sr_series_uid: str | None,
    sr_sop_uid: str | None,
    items: list[MeasurementItem],
    parse_error: str | None,
) -> dict[str, Any]:
    return {
        "seriesUid": series_uid,
        "frameOfReferenceUid": for_uid,
        "srSeriesUid": sr_series_uid,
        "srSopUid": sr_sop_uid,
        "parseError": parse_error,
        "measurements": [_item_to_json(m) for m in items],
    }


@router.get("/series/{series_uid}/measurements")
def get_measurements(
    series_uid: str, conn: sqlite3.Connection = Depends(get_db)
) -> dict[str, Any]:
    if repo.get_series(conn, series_uid) is None:
        raise HTTPException(404, f"series {series_uid} not found")
    for_uid = _frame_of_reference(conn, series_uid)
    sr_series, newest = _current_sr(conn, series_uid)
    if sr_series is None or newest is None:
        return _envelope(series_uid, for_uid, None, None, [], None)
    try:
        items = parse_sr(pydicom.dcmread(newest.path))
    except (SrParseError, AttributeError, KeyError, ValueError, OSError) as e:
        # A report we cannot read must never stop the series opening.
        return _envelope(
            series_uid,
            for_uid,
            sr_series.series_uid,
            newest.sop_uid,
            [],
            f"{type(e).__name__}: {e}",
        )
    return _envelope(series_uid, for_uid, sr_series.series_uid, newest.sop_uid, items, None)


@router.put("/series/{series_uid}/measurements")
def put_measurements(
    series_uid: str,
    payload: dict[str, Any] = Body(...),
    conn: sqlite3.Connection = Depends(get_db),
    settings: Settings = Depends(get_settings_dep),
) -> dict[str, Any]:
    if repo.get_series(conn, series_uid) is None:
        raise HTTPException(404, f"series {series_uid} not found")
    instances = repo.list_instances(conn, series_uid)
    if not instances:
        raise HTTPException(404, f"series {series_uid} has no instances")
    for_uid = _frame_of_reference(conn, series_uid)

    items = [_item_from_json(raw) for raw in payload.get("measurements", [])]
    try:
        validate_set(items, frame_of_reference_uid=for_uid or "")
        # The coordinates are the ground truth, so the stored length and angle
        # are computed from them rather than taken from the client.
        items = [
            MeasurementItem(
                id=i.id,
                tool=i.tool,
                points=i.points,
                plane=i.plane,
                values=derive_values(i),
                label=i.label,
            )
            for i in items
        ]
    except SrValidationError as e:
        raise HTTPException(422, str(e)) from e

    sr_series, previous = _current_sr(conn, series_uid)
    sent = payload.get("srSopUid")
    current = previous.sop_uid if previous else None
    if sent != current:
        raise HTTPException(
            409, f"report changed since it was loaded (expected {current!r}, got {sent!r})"
        )

    sr_series_uid = sr_series.series_uid if sr_series else generate_uid()
    sop_uid = generate_uid()
    evidence: list[Dataset] = [pydicom.dcmread(instances[0].path, stop_before_pixels=True)]
    ds = build_sr(
        items,
        frame_of_reference_uid=for_uid or "",
        evidence=evidence,
        sr_series_uid=sr_series_uid,
        sr_sop_uid=sop_uid,
        instance_number=(previous.instance_number or 0) + 1 if previous else 1,
    )

    # Write the new report, index it, and only then drop the old one. The
    # reverse order can lose the only copy; this order can at worst leave an
    # extra instance, which _current_sr ignores because the newest wins.
    dest = file_instance(ds, settings.store_dir)
    index_instance(conn, ds, dest)
    with conn:
        repo.set_derived_from(conn, sr_series_uid, series_uid)
    if previous is not None:
        Path(previous.path).unlink(missing_ok=True)
        with conn:
            repo.delete_instance(conn, previous.sop_uid)
    finalize_series(conn, sr_series_uid)

    return _envelope(series_uid, for_uid, sr_series_uid, sop_uid, items, None)
