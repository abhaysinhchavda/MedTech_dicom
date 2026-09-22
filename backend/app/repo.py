from __future__ import annotations

import sqlite3
from typing import Any

from app.models import InstanceRow, SeriesRow, SortMethod, StudyRow, VolumeInfo


def upsert_study(conn: sqlite3.Connection, s: StudyRow) -> None:
    conn.execute(
        "INSERT OR REPLACE INTO study VALUES (?,?,?,?,?,?,?,?)",
        (
            s.study_uid,
            s.patient_name,
            s.patient_id,
            s.study_date,
            s.study_time,
            s.study_desc,
            s.accession,
            ",".join(sorted(set(s.modalities))),
        ),
    )


def upsert_series(conn: sqlite3.Connection, s: SeriesRow) -> None:
    conn.execute(
        """INSERT INTO series (series_uid, study_uid, modality, series_desc, series_number)
           VALUES (?,?,?,?,?)
           ON CONFLICT(series_uid) DO UPDATE SET modality=excluded.modality,
             series_desc=excluded.series_desc, series_number=excluded.series_number""",
        (s.series_uid, s.study_uid, s.modality, s.series_desc, s.series_number),
    )


def upsert_instance(conn: sqlite3.Connection, i: InstanceRow) -> None:
    ipp = i.ipp or (None, None, None)
    conn.execute(
        "INSERT OR REPLACE INTO instance VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            i.sop_uid,
            i.series_uid,
            i.instance_number,
            i.rows,
            i.cols,
            i.bits_allocated,
            i.pixel_representation,
            i.samples_per_pixel,
            i.num_frames,
            ipp[0],
            ipp[1],
            ipp[2],
            "\\".join(map(str, i.iop)) if i.iop else None,
            "\\".join(map(str, i.pixel_spacing)) if i.pixel_spacing else None,
            i.path,
            i.transfer_syntax,
        ),
    )


def update_series_finalized(
    conn: sqlite3.Connection,
    series_uid: str,
    *,
    instance_count: int,
    frame_count: int,
    thumb_sop_uid: str | None,
    sort_method: SortMethod,
    volume: VolumeInfo,
) -> None:
    d, sp, o = (
        volume.dims or (None,) * 3,
        volume.spacing or (None,) * 3,
        volume.origin or (None,) * 3,
    )
    conn.execute(
        """UPDATE series SET instance_count=?, frame_count=?, thumb_sop_uid=?, sort_method=?,
           is_volume=?, volume_reason=?, dim_x=?, dim_y=?, dim_z=?, spacing_x=?, spacing_y=?,
           spacing_z=?, origin_x=?, origin_y=?, origin_z=?, direction=? WHERE series_uid=?""",
        (
            instance_count,
            frame_count,
            thumb_sop_uid,
            sort_method,
            int(volume.is_volume),
            volume.reason,
            d[0],
            d[1],
            d[2],
            sp[0],
            sp[1],
            sp[2],
            o[0],
            o[1],
            o[2],
            "\\".join(map(str, volume.direction)) if volume.direction else None,
            series_uid,
        ),
    )


def _study_from_row(r: sqlite3.Row) -> StudyRow:
    return StudyRow(
        r["study_uid"],
        r["patient_name"],
        r["patient_id"],
        r["study_date"],
        r["study_time"],
        r["study_desc"],
        r["accession"],
        [m for m in (r["modalities"] or "").split(",") if m],
    )


def _series_from_row(r: sqlite3.Row) -> SeriesRow:
    vol = (
        VolumeInfo(
            bool(r["is_volume"]),
            r["volume_reason"],
            dims=(r["dim_x"], r["dim_y"], r["dim_z"]) if r["dim_x"] is not None else None,
            spacing=(r["spacing_x"], r["spacing_y"], r["spacing_z"])
            if r["spacing_x"] is not None
            else None,
            origin=(r["origin_x"], r["origin_y"], r["origin_z"])
            if r["origin_x"] is not None
            else None,
            direction=tuple(float(v) for v in r["direction"].split("\\"))
            if r["direction"]
            else None,
        )
        if r["sort_method"] is not None
        else VolumeInfo(False, "not finalized")
    )
    return SeriesRow(
        r["series_uid"],
        r["study_uid"],
        r["modality"],
        r["series_desc"],
        r["series_number"],
        r["instance_count"] or 0,
        r["thumb_sop_uid"],
        r["sort_method"],
        vol,
        r["frame_count"] or 0,
    )


def _parse_iop(s: str | None) -> tuple[float, float, float, float, float, float] | None:
    """Parse a backslash-joined IOP string into a fixed 6-tuple of floats."""
    if not s:
        return None
    parts = [float(v) for v in s.split("\\")]
    if len(parts) != 6:
        raise ValueError(f"expected 6 values for iop, got {len(parts)}: {s!r}")
    return (parts[0], parts[1], parts[2], parts[3], parts[4], parts[5])


def _parse_pixel_spacing(s: str | None) -> tuple[float, float] | None:
    """Parse a backslash-joined pixel-spacing string into a fixed 2-tuple of floats."""
    if not s:
        return None
    parts = [float(v) for v in s.split("\\")]
    if len(parts) != 2:
        raise ValueError(f"expected 2 values for pixel_spacing, got {len(parts)}: {s!r}")
    return (parts[0], parts[1])


def _instance_from_row(r: sqlite3.Row) -> InstanceRow:
    ipp = (
        (float(r["ipp_x"]), float(r["ipp_y"]), float(r["ipp_z"]))
        if r["ipp_x"] is not None
        else None
    )
    iop = _parse_iop(r["iop"])
    ps = _parse_pixel_spacing(r["pixel_spacing"])
    return InstanceRow(
        r["sop_uid"],
        r["series_uid"],
        r["instance_number"],
        r["rows"],
        r["cols"],
        r["bits_allocated"],
        r["pixel_representation"],
        r["samples_per_pixel"],
        r["num_frames"],
        ipp,
        iop,
        ps,
        r["path"],
        r["transfer_syntax"],
    )


_LIKE_ESCAPE = "\\"


def _escape_like(s: str) -> str:
    """Escape SQLite LIKE metacharacters so user input can't inject wildcards."""
    return (
        s.replace(_LIKE_ESCAPE, _LIKE_ESCAPE * 2).replace("%", f"{_LIKE_ESCAPE}%")
        .replace("_", f"{_LIKE_ESCAPE}_")
    )


def list_studies(
    conn: sqlite3.Connection,
    *,
    patient_name: str | None = None,
    patient_id: str | None = None,
    study_date: str | None = None,
    limit: int = 100,
    offset: int = 0,
) -> list[StudyRow]:
    where: list[str] = []
    args: list[Any] = []
    if patient_name:
        where.append(f"LOWER(patient_name) LIKE ? ESCAPE '{_LIKE_ESCAPE}'")
        args.append(f"%{_escape_like(patient_name.lower().strip('*'))}%")
    if patient_id:
        where.append("patient_id = ?")
        args.append(patient_id)
    if study_date:
        where.append("study_date = ?")
        args.append(study_date)
    sql = "SELECT * FROM study" + (" WHERE " + " AND ".join(where) if where else "")
    sql += " ORDER BY study_date DESC, study_uid LIMIT ? OFFSET ?"
    return [_study_from_row(r) for r in conn.execute(sql, (*args, limit, offset))]


def get_study(conn: sqlite3.Connection, uid: str) -> StudyRow | None:
    r = conn.execute("SELECT * FROM study WHERE study_uid=?", (uid,)).fetchone()
    return _study_from_row(r) if r else None


def list_series(conn: sqlite3.Connection, study_uid: str) -> list[SeriesRow]:
    rows = conn.execute(
        "SELECT * FROM series WHERE study_uid=? ORDER BY series_number, series_uid", (study_uid,)
    )
    return [_series_from_row(r) for r in rows]


def get_series(conn: sqlite3.Connection, series_uid: str) -> SeriesRow | None:
    r = conn.execute("SELECT * FROM series WHERE series_uid=?", (series_uid,)).fetchone()
    return _series_from_row(r) if r else None


def list_instances(conn: sqlite3.Connection, series_uid: str) -> list[InstanceRow]:
    rows = conn.execute("SELECT * FROM instance WHERE series_uid=?", (series_uid,))
    return [_instance_from_row(r) for r in rows]


def get_instance(conn: sqlite3.Connection, sop_uid: str) -> InstanceRow | None:
    r = conn.execute("SELECT * FROM instance WHERE sop_uid=?", (sop_uid,)).fetchone()
    return _instance_from_row(r) if r else None


def count_series_and_instances(conn: sqlite3.Connection, study_uid: str) -> tuple[int, int]:
    r = conn.execute(
        """SELECT COUNT(DISTINCT s.series_uid), COUNT(i.sop_uid) FROM series s
           LEFT JOIN instance i ON i.series_uid = s.series_uid WHERE s.study_uid=?""",
        (study_uid,),
    ).fetchone()
    return int(r[0]), int(r[1])
