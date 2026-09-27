from __future__ import annotations

import sqlite3
from pathlib import Path

from pydicom.dataset import Dataset

from app import repo
from app.geometry import sort_instances, volume_info
from app.ingest.decode import DecodeError, to_uncompressed
from app.ingest.reader import SEG_SOP_CLASS, NotDicomError, read_dicom
from app.ingest.store import file_instance
from app.models import (
    IngestSummary,
    InstanceRow,
    SeriesRow,
    SkippedFile,
    StudyRow,
    VolumeInfo,
)


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
    # A Structured Report is a DICOM instance with no pixels, so every
    # image-only attribute below is optional. Images keep the defaults they
    # always had; non-image objects get None.
    is_image = "PixelData" in ds
    return InstanceRow(
        sop_uid=str(ds.SOPInstanceUID),
        series_uid=str(ds.SeriesInstanceUID),
        instance_number=(
            int(ds.InstanceNumber) if ds.get("InstanceNumber") not in (None, "") else None
        ),
        # Still read strictly for an image: an image with no Rows is malformed
        # and must raise here so ingest_files skips it with a reason, exactly
        # as it did before non-image objects existed.
        rows=int(ds.Rows) if is_image else None,
        cols=int(ds.Columns) if is_image else None,
        bits_allocated=int(ds.BitsAllocated) if is_image else None,
        pixel_representation=int(ds.get("PixelRepresentation", 0)) if is_image else None,
        samples_per_pixel=int(ds.get("SamplesPerPixel", 1)) if is_image else None,
        num_frames=int(ds.get("NumberOfFrames", 1) or 1) if is_image else None,
        ipp=_floats3(ds, "ImagePositionPatient"),
        iop=_floats6(ds, "ImageOrientationPatient"),
        pixel_spacing=_floats2(ds, "PixelSpacing"),
        sop_class_uid=str(ds.get("SOPClassUID", "")) or None,
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
    if rows and all(r.rows is None for r in rows):
        # A non-image series has no geometry to check and no frame to render as
        # a thumbnail. thumb_sop_uid must stay null: the study browser only
        # asks for `rendered` when one is set, and `rendered` cannot produce a
        # PNG from a Structured Report.
        with conn:
            repo.update_series_finalized(
                conn,
                series_uid,
                instance_count=len(rows),
                frame_count=0,
                thumb_sop_uid=None,
                sort_method="instance-number",
                volume=VolumeInfo(False, "structured report, not an image series"),
            )
        non_image = repo.get_series(conn, series_uid)
        assert non_image is not None
        return non_image
    if rows and all(r.sop_class_uid == SEG_SOP_CLASS for r in rows):
        # A segmentation is an overlay, never an openable volume. Left to the
        # geometry check it would be rejected for whatever it happens to lack
        # first, which is true but tells the user nothing about what it is.
        with conn:
            repo.update_series_finalized(
                conn,
                series_uid,
                instance_count=len(rows),
                frame_count=sum(r.num_frames or 0 for r in rows),
                thumb_sop_uid=None,
                sort_method="instance-number",
                volume=VolumeInfo(False, "segmentation, not an image series"),
            )
        seg_series = repo.get_series(conn, series_uid)
        assert seg_series is not None
        return seg_series
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
            frame_count=sum(r.num_frames or 0 for r in ordered),
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
