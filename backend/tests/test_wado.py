import io
from pathlib import Path

import numpy as np
import pydicom
from PIL import Image

from app.ingest.indexer import ingest_directory
from tests.conftest import make_ct_series, write_series


def _seed(client, tmp_path: Path, n=4, **kw):
    dsets = make_ct_series(n, **kw)
    write_series(dsets, tmp_path / "in")
    ingest_directory(client.app.state.db, tmp_path / "in", client.app.state.settings.store_dir)
    return dsets


def _url(d, sop=None):
    base = f"/dicomweb/studies/{d[0].StudyInstanceUID}/series/{d[0].SeriesInstanceUID}"
    return base if sop is None else f"{base}/instances/{sop}"


def test_metadata_is_sorted_full_headers_without_pixels(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path, 5)
    d_reversed = list(reversed(d))  # write order != anatomical order
    write_series(d_reversed, tmp_path / "in2")
    r = client.get(_url(d) + "/metadata")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/dicom+json")
    assert r.headers["x-sort-method"] == "geometry"
    md = r.json()
    assert [m["00200032"]["Value"][2] for m in md] == [0.0, 1.0, 2.0, 3.0, 4.0]
    assert all("7FE00010" not in m for m in md)
    assert md[0]["00020010"]["Value"] == ["1.2.840.10008.1.2.1"]
    assert md[0]["00281053"]["Value"] == [1.0] and md[0]["00281050"]["Value"] == [40.0]


def test_frame_bytes_and_multipart_framing(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path, 2)
    url = _url(d, d[0].SOPInstanceUID) + "/frames/1"
    r = client.get(url, headers={"Accept": "application/octet-stream"})
    assert r.status_code == 200
    ct = r.headers["content-type"]
    assert ct.startswith('multipart/related; type="application/octet-stream"; boundary=')
    boundary = ct.split("boundary=")[1].strip('"')
    body = r.content
    assert body.startswith(f"--{boundary}\r\n".encode())
    assert body.rstrip().endswith(f"--{boundary}--".encode())
    head, _, rest = body.partition(b"\r\n\r\n")
    assert b"Content-Type: application/octet-stream" in head
    payload = rest[: 16 * 16 * 2]
    assert np.array_equal(np.frombuffer(payload, dtype="<i2").reshape(16, 16), d[0].pixel_array)
    assert r.headers["cache-control"] == "public, max-age=86400" and "content-length" in r.headers


def test_frame_out_of_range_and_unknown_404(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path, 1)
    assert client.get(_url(d, d[0].SOPInstanceUID) + "/frames/2").status_code == 404
    assert client.get(_url(d, "9.9") + "/frames/1").status_code == 404
    assert client.get("/dicomweb/studies/1/series/2/metadata").status_code == 404


def test_instance_download_is_valid_dicom(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path, 1)
    r = client.get(_url(d, d[0].SOPInstanceUID))
    assert r.headers["content-type"].startswith('multipart/related; type="application/dicom"')
    _, _, rest = r.content.partition(b"\r\n\r\n")
    boundary = r.headers["content-type"].split("boundary=")[1].strip('"')
    dcm_bytes = rest.rsplit(f"\r\n--{boundary}--".encode(), 1)[0]
    ds = pydicom.dcmread(io.BytesIO(dcm_bytes))
    assert ds.SOPInstanceUID == d[0].SOPInstanceUID


def test_rendered_png_thumbnail(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path, 1)
    r = client.get(_url(d, d[0].SOPInstanceUID) + "/rendered", params={"viewport": "8,8"})
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    img = Image.open(io.BytesIO(r.content))
    assert img.size == (8, 8) and img.mode == "L"


def test_multiframe_frames_and_rendered(client, tmp_path: Path) -> None:
    (ds,) = make_ct_series(1)
    ds.NumberOfFrames = 3
    ds.PixelData = np.stack(
        [np.full((16, 16), k * 100, dtype=np.int16) for k in range(3)]
    ).tobytes()
    in_dir = tmp_path / "in"
    in_dir.mkdir(parents=True, exist_ok=True)
    pydicom.dcmwrite(in_dir / "img0000.dcm", ds, enforce_file_format=True)
    ingest_directory(client.app.state.db, in_dir, client.app.state.settings.store_dir)
    d = [ds]

    r2 = client.get(_url(d, ds.SOPInstanceUID) + "/frames/2")
    assert r2.status_code == 200
    _, _, rest2 = r2.content.partition(b"\r\n\r\n")
    arr2 = np.frombuffer(rest2[: 16 * 16 * 2], dtype="<i2").reshape(16, 16)
    assert np.all(arr2 == 100)

    r3 = client.get(_url(d, ds.SOPInstanceUID) + "/frames/3")
    assert r3.status_code == 200
    _, _, rest3 = r3.content.partition(b"\r\n\r\n")
    arr3 = np.frombuffer(rest3[: 16 * 16 * 2], dtype="<i2").reshape(16, 16)
    assert np.all(arr3 == 200)

    assert client.get(_url(d, ds.SOPInstanceUID) + "/frames/4").status_code == 404

    r = client.get(_url(d, ds.SOPInstanceUID) + "/rendered", params={"viewport": "8,8"})
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    img = Image.open(io.BytesIO(r.content))
    assert img.size == (8, 8) and img.mode == "L"
    assert len(np.unique(np.asarray(img))) == 1

    instances_url = (
        f"/dicomweb/studies/{ds.StudyInstanceUID}/series/{ds.SeriesInstanceUID}/instances"
    )
    ir = client.get(instances_url)
    assert ir.status_code == 200
    md = ir.json()
    assert md[0]["00280008"]["Value"] == [3]
