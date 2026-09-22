import io
import zipfile
from pathlib import Path

from tests.conftest import make_ct_series, write_series


def _files(paths: list[Path]):
    return [("files", (p.name, p.read_bytes(), "application/dicom")) for p in paths]


def test_upload_dicom_files(client, tmp_path: Path) -> None:
    d = make_ct_series(3)
    paths = write_series(d, tmp_path / "up")
    r = client.post("/api/upload", files=_files(paths))
    assert r.status_code == 200
    assert r.json() == {"accepted": 3, "skipped": [], "studyUids": [d[0].StudyInstanceUID]}
    assert len(client.get("/dicomweb/studies").json()) == 1


def test_upload_zip_with_mixed_content(client, tmp_path: Path) -> None:
    d = make_ct_series(3)
    paths = write_series(d, tmp_path / "up")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        for p in paths:
            z.write(p, f"sub/{p.name}")
        z.writestr("README.txt", "not dicom")
    r = client.post("/api/upload", files=[("files", ("s.zip", buf.getvalue(), "application/zip"))])
    j = r.json()
    assert r.status_code == 200 and j["accepted"] == 3
    assert (
        j["skipped"] == [{"file": "README.txt", "reason": j["skipped"][0]["reason"]}]
        and "README" in j["skipped"][0]["file"]
    )


def test_zip_path_traversal_rejected(client) -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("../evil.dcm", b"x")
    r = client.post("/api/upload", files=[("files", ("s.zip", buf.getvalue(), "application/zip"))])
    assert r.status_code == 400


def test_zip_path_traversal_backslash_rejected(client) -> None:
    # A backslash-containing entry name is a single opaque PurePosixPath part
    # (no "/" in it), so it slips past the "'..' in parts" check -- but on
    # Windows, Path(*parts) then reinterprets the backslash as a separator,
    # which is exactly the escape the shared containment check must catch.
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("..\\evil.dcm", b"x")
    r = client.post("/api/upload", files=[("files", ("s.zip", buf.getvalue(), "application/zip"))])
    assert r.status_code == 400


def test_too_large_rejected(client) -> None:
    big = b"\0" * (6 * 1024 * 1024)  # settings fixture sets max_upload_mb=5
    r = client.post("/api/upload", files=[("files", ("big.dcm", big, "application/dicom"))])
    assert r.status_code == 413


def test_duplicate_basenames_across_folders_are_all_ingested(client, tmp_path: Path) -> None:
    d1 = make_ct_series(3)
    d2 = make_ct_series(3)
    paths1 = write_series(d1, tmp_path / "a")
    paths2 = write_series(d2, tmp_path / "b")
    renamed: list[Path] = []
    for paths in (paths1, paths2):
        for i, p in enumerate(paths):
            new_p = p.with_name(f"{i}.dcm")
            p.rename(new_p)
            renamed.append(new_p)
    r = client.post("/api/upload", files=_files(renamed))
    j = r.json()
    assert r.status_code == 200
    assert j["accepted"] == 6
    assert len(j["studyUids"]) == 2


def test_zip_bomb_rejected(client) -> None:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("big.dcm", b"\0" * (6 * 1024 * 1024))  # settings fixture caps at 5 MB
    files = [("files", ("bomb.zip", buf.getvalue(), "application/zip"))]
    r = client.post("/api/upload", files=files)
    assert r.status_code == 413


def test_corrupted_zip_rejected(client) -> None:
    r = client.post("/api/upload", files=[("files", ("x.zip", b"not a zip", "application/zip"))])
    assert r.status_code == 400
