from __future__ import annotations

from pathlib import Path
from typing import Any

import pydicom
from fastapi.testclient import TestClient

from app import repo
from app.ingest.indexer import ingest_files
from tests.conftest import make_ct_series

FOR_UID = "1.2.826.0.1.3680043.8.498.777"
UID = "2.25.100000000000000000000000000000001"


def seed(client: TestClient, tmp_path: Path, *, frame_of_reference: bool = True) -> str:
    """Ingest a 4-slice CT series, with or without a frame of reference."""
    datasets = make_ct_series(4)
    paths = []
    for i, ds in enumerate(datasets):
        if frame_of_reference:
            ds.FrameOfReferenceUID = FOR_UID
        elif "FrameOfReferenceUID" in ds:
            del ds.FrameOfReferenceUID
        p = tmp_path / f"{'f' if frame_of_reference else 'n'}{i}.dcm"
        pydicom.dcmwrite(p, ds, enforce_file_format=True)
        paths.append(p)
    ingest_files(client.app.state.db, paths, client.app.state.settings.store_dir)
    return str(datasets[0].SeriesInstanceUID)


def length_payload(value: float = 5.0) -> dict[str, Any]:
    return {
        "id": UID,
        "tool": "Length",
        "points": [[0.0, 0.0, 0.0], [3.0, 4.0, 0.0]],
        "plane": {"normal": [0.0, 0.0, 1.0], "up": [0.0, -1.0, 0.0]},
        "values": [{"name": "Length", "value": value, "unit": "mm"}],
        "label": None,
    }


def study_uid_of(client: TestClient) -> str:
    return str(client.get("/dicomweb/studies").json()[0]["0020000D"]["Value"][0])


def test_get_returns_an_empty_set_when_there_is_no_report(
    client: TestClient, tmp_path: Path
) -> None:
    series_uid = seed(client, tmp_path)
    body = client.get(f"/api/series/{series_uid}/measurements").json()
    assert body["measurements"] == []
    assert body["srSopUid"] is None
    assert body["parseError"] is None
    assert body["frameOfReferenceUid"] == FOR_UID


def test_put_then_get_round_trips_through_the_store(
    client: TestClient, tmp_path: Path
) -> None:
    series_uid = seed(client, tmp_path)
    put = client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": None, "measurements": [length_payload()]},
    )
    assert put.status_code == 200, put.text
    sop = put.json()["srSopUid"]
    assert sop

    got = client.get(f"/api/series/{series_uid}/measurements").json()
    assert got["srSopUid"] == sop
    assert len(got["measurements"]) == 1
    assert got["measurements"][0]["values"][0]["value"] == 5.0
    assert got["measurements"][0]["tool"] == "Length"
    assert got["measurements"][0]["id"] == UID


def test_the_report_is_retrievable_through_wado(client: TestClient, tmp_path: Path) -> None:
    series_uid = seed(client, tmp_path)
    put = client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": None, "measurements": [length_payload()]},
    ).json()
    r = client.get(
        f"/dicomweb/studies/{study_uid_of(client)}/series/{put['srSeriesUid']}"
        f"/instances/{put['srSopUid']}"
    )
    assert r.status_code == 200


def test_saving_twice_replaces_rather_than_accumulates(
    client: TestClient, tmp_path: Path
) -> None:
    series_uid = seed(client, tmp_path)
    first = client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": None, "measurements": [length_payload()]},
    ).json()
    second = client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": first["srSopUid"], "measurements": [length_payload()]},
    ).json()

    assert second["srSopUid"] != first["srSopUid"]
    assert second["srSeriesUid"] == first["srSeriesUid"]
    instances = client.get(
        f"/dicomweb/studies/{study_uid_of(client)}/series/{second['srSeriesUid']}/instances"
    ).json()
    assert len(instances) == 1


def test_a_stale_sop_uid_is_rejected(client: TestClient, tmp_path: Path) -> None:
    series_uid = seed(client, tmp_path)
    client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": None, "measurements": [length_payload()]},
    )
    r = client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": "1.2.3.4", "measurements": [length_payload()]},
    )
    assert r.status_code == 409


def test_the_stored_length_is_computed_from_the_coordinates(
    client: TestClient, tmp_path: Path
) -> None:
    # The client sends nonsense; the report still records 5.0, the distance
    # between the two points it also stores. A consumer reading the SCOORD3D
    # and the NUM beside it must find them agreeing.
    series_uid = seed(client, tmp_path)
    r = client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": None, "measurements": [length_payload(value=99.0)]},
    )
    assert r.status_code == 200, r.text
    assert r.json()["measurements"][0]["values"] == [{"name": "Length", "value": 5.0, "unit": "mm"}]

    got = client.get(f"/api/series/{series_uid}/measurements").json()
    assert got["measurements"][0]["values"][0]["value"] == 5.0


def test_a_degenerate_angle_is_rejected(client: TestClient, tmp_path: Path) -> None:
    series_uid = seed(client, tmp_path)
    r = client.put(
        f"/api/series/{series_uid}/measurements",
        json={
            "srSopUid": None,
            "measurements": [
                {
                    **length_payload(),
                    "tool": "Angle",
                    "points": [[0.0, 0.0, 0.0], [0.0, 0.0, 0.0], [1.0, 1.0, 0.0]],
                    "values": [{"name": "Angle", "value": 45.0, "unit": "deg"}],
                }
            ],
        },
    )
    assert r.status_code == 422


def test_a_bidirectional_set_round_trips_with_both_axes(
    client: TestClient, tmp_path: Path
) -> None:
    series_uid = seed(client, tmp_path)
    put = client.put(
        f"/api/series/{series_uid}/measurements",
        json={
            "srSopUid": None,
            "measurements": [
                {
                    **length_payload(),
                    "tool": "Bidirectional",
                    "points": [
                        [0.0, 0.0, 0.0],
                        [20.0, 0.0, 0.0],
                        [10.0, -5.0, 0.0],
                        [10.0, 5.0, 0.0],
                    ],
                    "values": [
                        {"name": "LongAxis", "value": 111.0, "unit": "mm"},
                        {"name": "ShortAxis", "value": 222.0, "unit": "mm"},
                    ],
                }
            ],
        },
    )
    assert put.status_code == 200, put.text

    got = client.get(f"/api/series/{series_uid}/measurements").json()
    (m,) = got["measurements"]
    assert m["tool"] == "Bidirectional"
    assert len(m["points"]) == 4
    # Both axes are geometry, so the client's numbers are discarded.
    assert m["values"] == [
        {"name": "LongAxis", "value": 20.0, "unit": "mm"},
        {"name": "ShortAxis", "value": 10.0, "unit": "mm"},
    ]


def test_a_corrupt_report_yields_parse_error_not_a_500(
    client: TestClient, tmp_path: Path
) -> None:
    series_uid = seed(client, tmp_path)
    put = client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": None, "measurements": [length_payload()]},
    ).json()

    inst = repo.get_instance(client.app.state.db, put["srSopUid"])
    assert inst is not None
    ds = pydicom.dcmread(inst.path)
    del ds.ContentSequence  # still a valid file, no longer a report we can read
    pydicom.dcmwrite(inst.path, ds, enforce_file_format=True)

    body = client.get(f"/api/series/{series_uid}/measurements").json()
    assert body["measurements"] == []
    assert body["parseError"]


def test_a_series_without_a_frame_of_reference_refuses_measurement(
    client: TestClient, tmp_path: Path
) -> None:
    series_uid = seed(client, tmp_path, frame_of_reference=False)

    body = client.get(f"/api/series/{series_uid}/measurements").json()
    assert body["frameOfReferenceUid"] is None

    r = client.put(
        f"/api/series/{series_uid}/measurements",
        json={"srSopUid": None, "measurements": [length_payload()]},
    )
    assert r.status_code == 422
