from __future__ import annotations

import shutil
import sqlite3
import tempfile
import zipfile
from dataclasses import asdict
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, UploadFile

from app.config import Settings
from app.dicomweb.deps import get_db, get_settings_dep
from app.ingest.indexer import ingest_files

router = APIRouter(prefix="/api", tags=["upload"])


def _safe_extract(zf: zipfile.ZipFile, dest: Path) -> list[Path]:
    out: list[Path] = []
    for info in zf.infolist():
        name = PurePosixPath(info.filename)
        if name.is_absolute() or ".." in name.parts:
            raise HTTPException(400, f"zip entry has an unsafe path: {info.filename}")
        if info.is_dir():
            continue
        target = dest / Path(*name.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        with zf.open(info) as src, target.open("wb") as dst:
            shutil.copyfileobj(src, dst)
        out.append(target)
    return out


@router.post("/upload")
async def upload(files: list[UploadFile], conn: sqlite3.Connection = Depends(get_db),
                 settings: Settings = Depends(get_settings_dep)) -> dict[str, Any]:
    limit = settings.max_upload_mb * 1024 * 1024
    total = 0
    tmp = Path(tempfile.mkdtemp(prefix="upload-"))
    try:
        paths: list[Path] = []
        for f in files:
            data = await f.read()
            total += len(data)
            if total > limit:
                raise HTTPException(413, f"upload exceeds {settings.max_upload_mb} MB")
            name = Path(f.filename or "file").name
            p = tmp / name
            p.write_bytes(data)
            if name.lower().endswith(".zip"):
                try:
                    with zipfile.ZipFile(p) as zf:
                        paths.extend(_safe_extract(zf, tmp / f"{name}.d"))
                except zipfile.BadZipFile as e:
                    raise HTTPException(400, f"{name}: not a valid zip") from e
            else:
                paths.append(p)
        summary = ingest_files(conn, paths, settings.store_dir)
        return {"accepted": summary.accepted, "skipped": [asdict(s) for s in summary.skipped],
                "studyUids": summary.study_uids}
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
