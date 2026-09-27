from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np
import pydicom
from fastapi.testclient import TestClient

from app import repo
from app.ingest.indexer import ingest_files
from tests.conftest import make_ct_series

FOR_UID = "1.2.826.0.1.3680043.8.498.555"
TRACKING_UID = "2.25.100000000000000000000000000000001"
# make_ct_series defaults to 16x16; four slices gives a 16x16x4 volume.
DIMS = (16, 16, 4)


def seed(client: TestClient, tmp_path: Path) -> str:
    """Ingest a 4-slice CT series carrying a frame of reference."""
    datasets = make_ct_series(4)
    paths = []
    for i, ds in enumerate(datasets):
        ds.FrameOfReferenceUID = FOR_UID
        p = tmp_path / f"s{i}.dcm"
        pydicom.dcmwrite(p, ds, enforce_file_format=True)
        paths.append(p)
    ingest_files(client.app.state.db, paths, client.app.state.settings.store_dir)
    return str(datasets[0].SeriesInstanceUID)


def labelmap_bytes(dims: tuple[int, int, int] = DIMS, value: int = 1) -> bytes:
    nx, ny, nz = dims
    a = np.zeros((nz, ny, nx), dtype=np.uint8)
    a[nz // 2, ny // 2, nx // 2] = value
    return a.tobytes()


def meta(dims: tuple[int, int, int] = DIMS, seg_sop_uid: str | None = None) -> dict[str, Any]:
    return {
        "segSopUid": seg_sop_uid,
        "dims": list(dims),
        "segments": [
            {
                "number": 1,
                "label": "Tumour",
                "trackingUid": TRACKING_UID,
                "categoryCode": "49755003",
                "typeCode": "372087000",
            }
        ],
    }


def put(client: TestClient, series_uid: str, m: dict[str, Any], raw: bytes):  # type: ignore[no-untyped-def]
    return client.put(
        f"/api/series/{series_uid}/segmentation",
        data={"meta": json.dumps(m)},
        files={"labelmap": ("labelmap.bin", raw, "application/octet-stream")},
    )


def test_get_returns_an_empty_set_when_there_is_no_segmentation(
    client: TestClient, tmp_path: Path
) -> None:
    series_uid = seed(client, tmp_path)
    body = client.get(f"/api/series/{series_uid}/segmentation").json()
    assert body["segments"] == []
    assert body["segSopUid"] is None
    assert body["parseError"] is None
    assert body["dims"] == list(DIMS)
    assert body["frameOfReferenceUid"] == FOR_UID


def test_put_then_get_round_trips_through_the_store(client: TestClient, tmp_path: Path) -> None:
    series_uid = seed(client, tmp_path)
    r = put(client, series_uid, meta(), labelmap_bytes())
    assert r.status_code == 200, r.text
    sop = r.json()["segSopUid"]
    assert sop

    body = client.get(f"/api/series/{series_uid}/segmentation").json()
    assert body["segSopUid"] == sop
    assert [s["label"] for s in body["segments"]] == ["Tumour"]
    assert body["segments"][0]["trackingUid"] == TRACKING_UID

    raw = client.get(f"/api/series/{series_uid}/segmentation/labelmap").content
    nx, ny, nz = DIMS
    assert len(raw) == nx * ny * nz
    arr = np.frombuffer(raw, dtype=np.uint8)
    assert int((arr == 1).sum()) == 1


def test_the_segmentation_is_retrievable_through_wado(
    client: TestClient, tmp_path: Path
) -> None:
    series_uid = seed(client, tmp_path)
    body = put(client, series_uid, meta(), labelmap_bytes()).json()
    study_uid = client.get("/dicomweb/studies").json()[0]["0020000D"]["Value"][0]
    r = client.get(
        f"/dicomweb/studies/{study_uid}/series/{body['segSeriesUid']}"
        f"/instances/{body['segSopUid']}"
    )
    assert r.status_code == 200


def test_saving_twice_replaces_rather_than_accumulates(
    client: TestClient, tmp_path: Path
) -> None:
    series_uid = seed(client, tmp_path)
    first = put(client, series_uid, meta(), labelmap_bytes()).json()
    second = put(
        client, series_uid, meta(seg_sop_uid=first["segSopUid"]), labelmap_bytes()
    ).json()

    assert second["segSopUid"] != first["segSopUid"]
    assert second["segSeriesUid"] == first["segSeriesUid"]
    study_uid = client.get("/dicomweb/studies").json()[0]["0020000D"]["Value"][0]
    instances = client.get(
        f"/dicomweb/studies/{study_uid}/series/{second['segSeriesUid']}/instances"
    ).json()
    assert len(instances) == 1


def test_a_stale_seg_sop_uid_is_rejected(client: TestClient, tmp_path: Path) -> None:
    series_uid = seed(client, tmp_path)
    put(client, series_uid, meta(), labelmap_bytes())
    r = put(client, series_uid, meta(seg_sop_uid="1.2.3.4"), labelmap_bytes())
    assert r.status_code == 409


def test_wrong_dims_are_rejected(client: TestClient, tmp_path: Path) -> None:
    series_uid = seed(client, tmp_path)
    wrong = (8, 8, 4)
    r = put(client, series_uid, meta(dims=wrong), labelmap_bytes(wrong))
    assert r.status_code == 422
    assert "do not match" in r.json()["detail"]


def test_a_wrong_length_labelmap_is_rejected(client: TestClient, tmp_path: Path) -> None:
    series_uid = seed(client, tmp_path)
    r = put(client, series_uid, meta(), labelmap_bytes()[:-1])
    assert r.status_code == 422
    assert "expected" in r.json()["detail"]


def test_an_undeclared_segment_value_is_rejected(client: TestClient, tmp_path: Path) -> None:
    series_uid = seed(client, tmp_path)
    # Paint value 3 while declaring only segment 1.
    r = put(client, series_uid, meta(), labelmap_bytes(value=3))
    assert r.status_code == 422
    assert "undeclared segment values" in r.json()["detail"]


def test_an_all_zero_save_deletes_the_segmentation(client: TestClient, tmp_path: Path) -> None:
    series_uid = seed(client, tmp_path)
    first = put(client, series_uid, meta(), labelmap_bytes()).json()

    nx, ny, nz = DIMS
    cleared = put(
        client,
        series_uid,
        meta(seg_sop_uid=first["segSopUid"]),
        bytes(nx * ny * nz),
    ).json()

    assert cleared["segSopUid"] is None
    body = client.get(f"/api/series/{series_uid}/segmentation").json()
    assert body["segSopUid"] is None
    assert body["segments"] == []
    assert client.get(f"/api/series/{series_uid}/segmentation/labelmap").status_code == 404


def test_a_corrupt_seg_yields_parse_error_not_a_500(client: TestClient, tmp_path: Path) -> None:
    series_uid = seed(client, tmp_path)
    body = put(client, series_uid, meta(), labelmap_bytes()).json()

    inst = repo.get_instance(client.app.state.db, body["segSopUid"])
    assert inst is not None
    ds = pydicom.dcmread(inst.path)
    del ds.SegmentSequence  # still a valid file, no longer a readable segmentation
    pydicom.dcmwrite(inst.path, ds, enforce_file_format=True)

    got = client.get(f"/api/series/{series_uid}/segmentation").json()
    assert got["segments"] == []
    assert got["parseError"]
