from __future__ import annotations

import sqlite3
from pathlib import Path

from pydicom.dataset import Dataset

from app import repo
from app.geometry import sort_instances, volume_info
from app.ingest.decode import DecodeError, to_uncompressed
from app.ingest.reader import NotDicomError, read_dicom
from app.ingest.store import file_instance
from app.models import IngestSummary, InstanceRow, SeriesRow, SkippedFile, StudyRow


def _floats2(ds: Dataset, tag: str) -> tuple[float, float] | None:
    v = ds.get(tag)
    if v is None:
        return None
    try:
        vals = [float(x) for x in v]
    except (TypeError, ValueError):
        return None
    if len(vals) != 2:
        return None
    return (vals[0], vals[1])


def _floats3(ds: Dataset, tag: str) -> tuple[float, float, float] | None:
    v = ds.get(tag)
    if v is None:
        return None
    try:
        vals = [float(x) for x in v]
    except (TypeError, ValueError):
        return None
    if len(vals) != 3:
        return None
    return (vals[0], vals[1], vals[2])


def _floats6(ds: Dataset, tag: str) -> tuple[float, float, float, float, float, float] | None:
    v = ds.get(tag)
    if v is None:
        return None
    try:
        vals = [float(x) for x in v]
    except (TypeError, ValueError):
        return None
    if len(vals) != 6:
        return None
    return (vals[0], vals[1], vals[2], vals[3], vals[4], vals[5])


def instance_row_from_dataset(ds: Dataset, path: Path) -> InstanceRow:
    return InstanceRow(
        sop_uid=str(ds.SOPInstanceUID),
        series_uid=str(ds.SeriesInstanceUID),
        instance_number=(
            int(ds.InstanceNumber) if ds.get("InstanceNumber") not in (None, "") else None
        ),
        rows=int(ds.Rows),
        cols=int(ds.Columns),
        bits_allocated=int(ds.BitsAllocated),
        pixel_representation=int(ds.get("PixelRepresentation", 0)),
        samples_per_pixel=int(ds.get("SamplesPerPixel", 1)),
        num_frames=int(ds.get("NumberOfFrames", 1) or 1),
        ipp=_floats3(ds, "ImagePositionPatient"),
        iop=_floats6(ds, "ImageOrientationPatient"),
        pixel_spacing=_floats2(ds, "PixelSpacing"),
        path=str(path),
        transfer_syntax=str(ds.file_meta.TransferSyntaxUID),
    )


def index_instance(conn: sqlite3.Connection, ds: Dataset, path: Path) -> None:
    # Build the InstanceRow FIRST: this is where a malformed dataset (e.g. a
    # missing Rows tag) raises AttributeError/KeyError/ValueError/TypeError. Doing
    # it before any repo writes means a brand-new study/series never gets a
    # ghost row when the very first (and only) file for it turns out malformed.
    row = instance_row_from_dataset(ds, path)
    study_uid = str(ds.StudyInstanceUID)
    existing = repo.get_study(conn, study_uid)
    mods = set(existing.modalities) if existing else set()
    if ds.get("Modality"):
        mods.add(str(ds.Modality))
    # Study + series + instance upserts happen as one atomic unit of work: `with
    # conn:` commits on success or rolls back on any exception, so callers never
    # observe a partially-indexed instance.
    with conn:
        repo.upsert_study(
            conn,
            StudyRow(
                study_uid,
                str(ds.get("PatientName", "")) or None,
                str(ds.get("PatientID", "")) or None,
                str(ds.get("StudyDate", "")) or None,
                str(ds.get("StudyTime", "")) or None,
                str(ds.get("StudyDescription", "")) or None,
                str(ds.get("AccessionNumber", "")) or None,
                sorted(mods),
            ),
        )
        repo.upsert_series(
            conn,
            SeriesRow(
                str(ds.SeriesInstanceUID),
                study_uid,
                str(ds.get("Modality", "")) or None,
                str(ds.get("SeriesDescription", "")) or None,
                int(ds.SeriesNumber) if ds.get("SeriesNumber") not in (None, "") else None,
            ),
        )
        repo.upsert_instance(conn, row)


def finalize_series(conn: sqlite3.Connection, series_uid: str) -> SeriesRow:
    rows = repo.list_instances(conn, series_uid)
    ordered, method = sort_instances(rows)
    vol = volume_info(ordered, method)
    thumb = ordered[len(ordered) // 2].sop_uid if ordered else None
    with conn:
        repo.update_series_finalized(
            conn,
            series_uid,
            # instance_count is the number of *instances* (rows) -- it feeds QIDO
            # 0020,1209 (NumberOfSeriesRelatedInstances) and volume-info.instanceCount.
            # frame_count is the number of *frames* and matches volume dims[2]; it is
            # tracked separately so the two are never conflated again.
            instance_count=len(ordered),
            frame_count=sum(r.num_frames for r in ordered),
            thumb_sop_uid=thumb,
            sort_method=method,
            volume=vol,
        )
    series = repo.get_series(conn, series_uid)
    assert series is not None
    return series


def ingest_files(conn: sqlite3.Connection, paths: list[Path], store_dir: Path) -> IngestSummary:
    summary = IngestSummary()
    touched: dict[str, str] = {}  # series_uid -> study_uid
    for p in paths:
        dest: Path | None = None
        try:
            ds = read_dicom(p)
            to_uncompressed(ds)
            dest = file_instance(ds, store_dir)
            index_instance(conn, ds, dest)
        except (NotDicomError, DecodeError) as e:
            summary.skipped.append(SkippedFile(p.name, str(e)))
            continue
        except (AttributeError, KeyError, ValueError, TypeError) as e:
            # file_instance already wrote the file (if we got that far) but
            # indexing failed, e.g. a malformed image tag -- don't leave an
            # orphan file under the store for a study/series that was never
            # (and, for a brand-new study, will never be) indexed.
            if dest is not None:
                dest.unlink(missing_ok=True)
            summary.skipped.append(SkippedFile(p.name, f"{type(e).__name__}: {e}"))
            continue
        touched[str(ds.SeriesInstanceUID)] = str(ds.StudyInstanceUID)
        summary.accepted += 1
    for series_uid in touched:
        finalize_series(conn, series_uid)
    summary.study_uids = sorted(set(touched.values()))
    return summary


def ingest_directory(conn: sqlite3.Connection, directory: Path, store_dir: Path) -> IngestSummary:
    paths = sorted(p for p in directory.rglob("*") if p.is_file())
    return ingest_files(conn, paths, store_dir)
