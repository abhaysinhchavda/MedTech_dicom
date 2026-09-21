from __future__ import annotations

import io
import sqlite3
from pathlib import Path

import numpy as np
import pydicom
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from PIL import Image
from pydicom.multival import MultiValue
from pydicom.uid import ExplicitVRLittleEndian

from app import repo
from app.dicomweb.deps import DICOM_JSON, get_db
from app.dicomweb.json_model import dataset_to_dicom_json
from app.dicomweb.multipart import multipart_related
from app.geometry import sort_instances
from app.models import InstanceRow, SeriesRow, SortMethod

router = APIRouter(prefix="/dicomweb", tags=["wado"])
FRAME_CACHE = "public, max-age=86400"


def load_sorted_series(
    conn: sqlite3.Connection, study_uid: str, series_uid: str
) -> tuple[SeriesRow, list[InstanceRow], SortMethod]:
    s = repo.get_series(conn, series_uid)
    if s is None or s.study_uid != study_uid:
        raise HTTPException(404, f"series {series_uid} not found in study {study_uid}")
    ordered, method = sort_instances(repo.list_instances(conn, series_uid))
    return s, ordered, method


def _instance_or_404(
    conn: sqlite3.Connection, study_uid: str, series_uid: str, sop_uid: str
) -> InstanceRow:
    i = repo.get_instance(conn, sop_uid)
    if i is None or i.series_uid != series_uid:
        raise HTTPException(404, f"instance {sop_uid} not found")
    s = repo.get_series(conn, series_uid)
    if s is None or s.study_uid != study_uid:
        raise HTTPException(404, f"series {series_uid} not found in study {study_uid}")
    return i


@router.get("/studies/{study_uid}/series/{series_uid}/metadata")
def series_metadata(
    study_uid: str, series_uid: str, conn: sqlite3.Connection = Depends(get_db)
) -> JSONResponse:
    _, ordered, method = load_sorted_series(conn, study_uid, series_uid)
    out = []
    for i in ordered:
        ds = pydicom.dcmread(i.path, stop_before_pixels=True)
        j = dataset_to_dicom_json(ds)
        j["00020010"] = {"vr": "UI", "Value": [str(ExplicitVRLittleEndian)]}
        out.append(j)
    return JSONResponse(out, media_type=DICOM_JSON, headers={"X-Sort-Method": method})


@router.get("/studies/{study_uid}/series/{series_uid}/instances/{sop_uid}/frames/{frame}")
def instance_frame(
    study_uid: str,
    series_uid: str,
    sop_uid: str,
    frame: int,
    conn: sqlite3.Connection = Depends(get_db),
) -> Response:
    i = _instance_or_404(conn, study_uid, series_uid, sop_uid)
    if frame < 1 or frame > i.num_frames:
        raise HTTPException(404, f"frame {frame} out of range 1..{i.num_frames}")
    ds = pydicom.dcmread(i.path)
    frame_len = i.rows * i.cols * i.samples_per_pixel * (i.bits_allocated // 8)
    start = (frame - 1) * frame_len
    payload = bytes(ds.PixelData[start : start + frame_len])
    body, ct = multipart_related([("application/octet-stream", payload)])
    headers = {"Cache-Control": FRAME_CACHE, "Content-Length": str(len(body))}
    return Response(body, media_type=ct, headers=headers)


@router.get("/studies/{study_uid}/series/{series_uid}/instances/{sop_uid}")
def instance_file(
    study_uid: str, series_uid: str, sop_uid: str, conn: sqlite3.Connection = Depends(get_db)
) -> Response:
    i = _instance_or_404(conn, study_uid, series_uid, sop_uid)
    body, ct = multipart_related([("application/dicom", Path(i.path).read_bytes())])
    return Response(body, media_type=ct, headers={"Cache-Control": FRAME_CACHE})


def _window(ds: pydicom.Dataset, arr: np.ndarray) -> np.ndarray:
    slope, intercept = float(ds.get("RescaleSlope", 1)), float(ds.get("RescaleIntercept", 0))
    hu = arr.astype(np.float32) * slope + intercept
    wc, ww = ds.get("WindowCenter"), ds.get("WindowWidth")
    if wc is None or ww is None:
        lo, hi = float(hu.min()), float(hu.max())
    else:
        c = float(wc[0] if isinstance(wc, MultiValue) else wc)
        w = float(ww[0] if isinstance(ww, MultiValue) else ww)
        lo, hi = c - w / 2, c + w / 2
    scaled = np.clip((hu - lo) / max(hi - lo, 1e-6), 0, 1) * 255
    if ds.get("PhotometricInterpretation") == "MONOCHROME1":
        scaled = 255 - scaled
    result: np.ndarray = scaled.astype(np.uint8)
    return result


@router.get("/studies/{study_uid}/series/{series_uid}/instances/{sop_uid}/rendered")
def instance_rendered(
    study_uid: str,
    series_uid: str,
    sop_uid: str,
    viewport: str = Query("128,128", pattern=r"^\d+,\d+$"),
    conn: sqlite3.Connection = Depends(get_db),
) -> Response:
    i = _instance_or_404(conn, study_uid, series_uid, sop_uid)
    ds = pydicom.dcmread(i.path)
    arr = ds.pixel_array
    if arr.ndim == 3 and i.num_frames > 1:
        arr = arr[i.num_frames // 2]
    img = Image.fromarray(_window(ds, arr), mode="L")
    w, h = (int(v) for v in viewport.split(","))
    img = img.resize((w, h), Image.Resampling.BILINEAR)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(buf.getvalue(), media_type="image/png", headers={"Cache-Control": FRAME_CACHE})
