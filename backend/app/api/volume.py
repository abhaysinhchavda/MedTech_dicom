from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, HTTPException

from app import repo
from app.dicomweb.deps import get_db

router = APIRouter(prefix="/api", tags=["volume"])


@router.get("/series/{series_uid}/volume-info")
def volume_info(series_uid: str, conn: sqlite3.Connection = Depends(get_db)) -> dict[str, Any]:
    s = repo.get_series(conn, series_uid)
    if s is None:
        raise HTTPException(404, f"series {series_uid} not found")
    v = s.volume
    est = None
    if v.dims:
        first = repo.list_instances(conn, series_uid)[0]
        est = (
            v.dims[0] * v.dims[1] * v.dims[2]
            * (first.bits_allocated // 8) * first.samples_per_pixel
        )
    return {
        "seriesUid": s.series_uid, "isVolume": v.is_volume, "reason": v.reason,
        "dims": list(v.dims) if v.dims else None, "spacing": list(v.spacing) if v.spacing else None,
        "origin": list(v.origin) if v.origin else None,
        "direction": list(v.direction) if v.direction else None,
        "modality": s.modality, "sortMethod": s.sort_method, "instanceCount": s.instance_count,
        "estimatedBytes": est,
    }
