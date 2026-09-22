from __future__ import annotations

import shutil
import sqlite3
import tempfile
import zipfile
from dataclasses import asdict
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile
from starlette.concurrency import run_in_threadpool

from app.config import Settings
from app.dicomweb.deps import get_db, get_settings_dep
from app.ingest.indexer import ingest_files
from app.ingest.store import _ensure_within

router = APIRouter(prefix="/api", tags=["upload"])

CHUNK_SIZE = 1 << 20


def _safe_extract(
    zf: zipfile.ZipFile, dest: Path, limit: int, total: int
) -> tuple[list[Path], int]:
    out: list[Path] = []
    for info in zf.infolist():
        name = PurePosixPath(info.filename)
        if name.is_absolute() or ".." in name.parts:
            raise HTTPException(400, f"zip entry has an unsafe path: {info.filename}")
        if info.is_dir():
            continue
        # Fast-reject using the header's declared size; the header can lie, so the
        # authoritative check happens below while copying actual decompressed bytes.
        if total + info.file_size > limit:
            raise HTTPException(413, f"zip contents exceed {limit} bytes")
        target = dest / Path(*name.parts)
        # Belt-and-suspenders: the PurePosixPath parts check above is fooled by a
        # backslash-containing entry name (e.g. "..\\evil.dcm") on Windows, where
        # Path(*name.parts) then re-interprets the backslash as a separator. This
        # containment check is authoritative regardless of how `target` was built.
        try:
            _ensure_within(dest, target)
        except ValueError as e:
            raise HTTPException(400, f"zip entry has an unsafe path: {info.filename}") from e
        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, target.open("wb") as dst:
            while chunk := src.read(CHUNK_SIZE):
                total += len(chunk)
                if total > limit:
                    raise HTTPException(413, f"zip contents exceed {limit} bytes")
                dst.write(chunk)
        out.append(target)
    return out, total


@router.post("/upload")
async def upload(files: list[UploadFile], conn: sqlite3.Connection = Depends(get_db),
                 settings: Settings = Depends(get_settings_dep)) -> dict[str, Any]:
    limit = settings.max_upload_mb * 1024 * 1024
    total = 0
    tmp = Path(tempfile.mkdtemp(prefix="upload-"))
    try:
        paths: list[Path] = []
        for idx, f in enumerate(files):
            # Each part gets its own subdirectory so identical basenames from
            # different source folders (or different zip parts) never collide.
            part_dir = tmp / f"{idx:06d}"
            part_dir.mkdir(parents=True, exist_ok=True)
            name = Path(f.filename or "file").name
            p = part_dir / name
            with p.open("wb") as out:
                while chunk := await f.read(CHUNK_SIZE):
                    total += len(chunk)
                    if total > limit:
                        raise HTTPException(413, f"upload exceeds {settings.max_upload_mb} MB")
                    out.write(chunk)
            if name.lower().endswith(".zip"):
                try:
                    with zipfile.ZipFile(p) as zf:
                        extracted, total = _safe_extract(zf, part_dir / f"{name}.d", limit, total)
                        paths.extend(extracted)
                except zipfile.BadZipFile as e:
                    raise HTTPException(400, f"{name}: not a valid zip") from e
            else:
                paths.append(p)
        # ingest_files does blocking disk + sqlite I/O; run it off the event loop.
        # The sqlite3 connection was opened with check_same_thread=False (see
        # app.db.connect), so handing it to the threadpool worker is safe.
        summary = await run_in_threadpool(ingest_files, conn, paths, settings.store_dir)
        return {"accepted": summary.accepted, "skipped": [asdict(s) for s in summary.skipped],
                "studyUids": summary.study_uids}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
