from __future__ import annotations

import sqlite3
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from app import repo
from app.dicomweb.deps import DICOM_JSON, get_db
from app.models import InstanceRow, SeriesRow, StudyRow

router = APIRouter(prefix="/dicomweb", tags=["qido"])


def _el(vr: str, *values: Any) -> dict[str, Any]:
    vals = [v for v in values if v not in (None, "")]
    return {"vr": vr, "Value": vals} if vals else {"vr": vr}


def study_json(conn: sqlite3.Connection, s: StudyRow) -> dict[str, Any]:
    n_series, n_inst = repo.count_series_and_instances(conn, s.study_uid)
    return {
        "00080020": _el("DA", s.study_date), "00080030": _el("TM", s.study_time),
        "00080050": _el("SH", s.accession), "00080061": _el("CS", *s.modalities),
        "00081030": _el("LO", s.study_desc),
        "00100010": (
            {"vr": "PN", "Value": [{"Alphabetic": s.patient_name}]}
            if s.patient_name
            else {"vr": "PN"}
        ),
        "00100020": _el("LO", s.patient_id), "0020000D": _el("UI", s.study_uid),
        "00201206": _el("IS", n_series), "00201208": _el("IS", n_inst),
    }


def series_json(s: SeriesRow) -> dict[str, Any]:
    return {
        "00080060": _el("CS", s.modality), "0008103E": _el("LO", s.series_desc),
        "0020000D": _el("UI", s.study_uid), "0020000E": _el("UI", s.series_uid),
        "00200011": _el("IS", s.series_number), "00201209": _el("IS", s.instance_count),
        "00080018": _el("UI", s.thumb_sop_uid),
    }


def instance_json(i: InstanceRow) -> dict[str, Any]:
    return {
        "00080018": _el("UI", i.sop_uid), "0020000E": _el("UI", i.series_uid),
        "00200013": _el("IS", i.instance_number), "00280008": _el("IS", i.num_frames),
        "00280010": _el("US", i.rows), "00280011": _el("US", i.cols),
    }


def _dj(payload: Any) -> JSONResponse:
    return JSONResponse(payload, media_type=DICOM_JSON)


@router.get("/studies")
def search_studies(
    conn: sqlite3.Connection = Depends(get_db),
    PatientName: str | None = None, PatientID: str | None = None, StudyDate: str | None = None,
    limit: int = Query(100, ge=1, le=1000), offset: int = Query(0, ge=0),
) -> JSONResponse:
    studies = repo.list_studies(conn, patient_name=PatientName, patient_id=PatientID,
                                study_date=StudyDate, limit=limit, offset=offset)
    return _dj([study_json(conn, s) for s in studies])


@router.get("/studies/{study_uid}/series")
def search_series(study_uid: str, conn: sqlite3.Connection = Depends(get_db)) -> JSONResponse:
    if repo.get_study(conn, study_uid) is None:
        raise HTTPException(404, f"study {study_uid} not found")
    return _dj([series_json(s) for s in repo.list_series(conn, study_uid)])


@router.get("/studies/{study_uid}/series/{series_uid}/instances")
def search_instances(
    study_uid: str, series_uid: str, conn: sqlite3.Connection = Depends(get_db)
) -> JSONResponse:
    s = repo.get_series(conn, series_uid)
    if s is None or s.study_uid != study_uid:
        raise HTTPException(404, f"series {series_uid} not found in study {study_uid}")
    return _dj([instance_json(i) for i in repo.list_instances(conn, series_uid)])
