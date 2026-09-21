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


def test_too_large_rejected(client) -> None:
    big = b"\0" * (6 * 1024 * 1024)  # settings fixture sets max_upload_mb=5
    r = client.post("/api/upload", files=[("files", ("big.dcm", big, "application/dicom"))])
    assert r.status_code == 413
