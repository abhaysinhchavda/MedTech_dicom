from pathlib import Path

from app.ingest.indexer import ingest_directory
from tests.conftest import make_ct_series, write_series


def _seed(client, tmp_path: Path, n=4, **kw):
    d = make_ct_series(n, **kw)
    write_series(d, tmp_path / "in")
    ingest_directory(client.app.state.db, tmp_path / "in", client.app.state.settings.store_dir)
    return d


def test_volume_info_for_volume(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path, 6)
    r = client.get(f"/api/series/{d[0].SeriesInstanceUID}/volume-info")
    assert r.status_code == 200
    j = r.json()
    assert j == {
        "seriesUid": d[0].SeriesInstanceUID, "isVolume": True, "reason": None,
        "dims": [16, 16, 6], "spacing": [0.5, 0.5, 1.0], "origin": [0.0, 0.0, 0.0],
        "direction": [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0],
        "modality": "CT", "sortMethod": "geometry", "instanceCount": 6,
        "estimatedBytes": 16 * 16 * 6 * 2,
    }


def test_volume_info_for_non_volume(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path, 2)
    j = client.get(f"/api/series/{d[0].SeriesInstanceUID}/volume-info").json()
    assert j["isVolume"] is False and j["reason"] == "fewer than 3 slices"
    assert j["dims"] is None and j["estimatedBytes"] is None and j["instanceCount"] == 2


def test_unknown_series_404(client) -> None:
    assert client.get("/api/series/9.9/volume-info").status_code == 404
