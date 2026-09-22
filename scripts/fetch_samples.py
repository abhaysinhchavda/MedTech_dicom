"""Download the bundled public sample studies into data/samples/ (run once).

Usage (repo root, backend venv active):  python scripts/fetch_samples.py [--force]
"""
from __future__ import annotations

import argparse
import io
import json
import shutil
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path

import numpy as np
import pydicom
from pydicom.uid import JPEG2000Lossless

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "scripts" / "samples.json"
SAMPLES = ROOT / "data" / "samples"


def verify_series(directory: Path, expected_uid: str, expected_count: int) -> None:
    files = sorted(directory.glob("*.dcm"))
    if len(files) != expected_count:
        sys.exit(f"{directory.name}: expected {expected_count} files, found {len(files)}")
    for f in files:
        ds = pydicom.dcmread(f, stop_before_pixels=True)
        if str(ds.SeriesInstanceUID) != expected_uid:
            sys.exit(f"{directory.name}: {f.name} belongs to series {ds.SeriesInstanceUID}")


def transcode_to_j2k(src: Path, dst: Path) -> None:
    ds = pydicom.dcmread(src)
    before = ds.pixel_array.copy()
    ds.compress(JPEG2000Lossless)
    if not np.array_equal(ds.pixel_array, before):
        sys.exit(f"{src.name}: JPEG 2000 transcode changed pixel values")
    dst.parent.mkdir(parents=True, exist_ok=True)
    pydicom.dcmwrite(dst, ds, enforce_file_format=True)


def download_zip(url: str) -> bytes:
    print(f"  downloading {url}")
    with urllib.request.urlopen(url, timeout=600) as r:  # noqa: S310 - fixed https URLs from manifest
        return r.read()


def _is_dicom_file(p: Path) -> bool:
    """True for real DICOM Part 10 files: `.dcm`-suffixed, or extensionless with
    the "DICM" magic at byte 128 (some TCIA collections ship instances with no
    extension). Rejects incidental archive members like a bare `LICENSE` file
    that would otherwise slip through an extension-only check.
    """
    if p.suffix.lower() == ".dcm":
        return True
    if p.suffix:
        return False
    try:
        with p.open("rb") as f:
            return f.read(132)[-4:] == b"DICM"
    except OSError:
        return False


def fetch(entry: dict[str, object], force: bool) -> None:
    out = SAMPLES / str(entry["id"])
    if out.exists() and not force:
        print(f"[skip] {entry['id']} already present")
        verify_series(out, str(entry["series_uid"]), int(entry["expected_count"]))
        return
    print(f"[fetch] {entry['title']}")
    data = download_zip(str(entry["source"]))
    tmp = Path(tempfile.mkdtemp(prefix="samples-"))
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            zf.extractall(tmp)
        dcms = sorted(p for p in tmp.rglob("*") if p.is_file() and _is_dicom_file(p))
        if out.exists():
            shutil.rmtree(out)
        out.mkdir(parents=True)
        for k, p in enumerate(dcms):
            dst = out / f"{k:04d}.dcm"
            if entry["transcode"]:
                transcode_to_j2k(p, dst)
            else:
                shutil.copyfile(p, dst)
        verify_series(out, str(entry["series_uid"]), int(entry["expected_count"]))
        (out / "LICENSE.txt").write_text(
            f"{entry['title']}\n{entry['license']}\nSource: {entry['source']}\n"
        )
        print(f"  ok: {len(dcms)} files -> {out}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-download even if present")
    args = ap.parse_args()
    for entry in json.loads(MANIFEST.read_text()):
        fetch(entry, args.force)


if __name__ == "__main__":
    main()
