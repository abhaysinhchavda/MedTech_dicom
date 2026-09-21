from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import make_ct_series, write_series


def test_startup_ingests_samples_dir(settings) -> None:
    d = make_ct_series(3)
    write_series(d, settings.samples_dir / "ct")
    with TestClient(create_app(settings)) as c:
        studies = c.get("/dicomweb/studies").json()
        assert [s["0020000D"]["Value"][0] for s in studies] == [d[0].StudyInstanceUID]


def test_startup_without_samples_dir_is_fine(settings) -> None:
    with TestClient(create_app(settings)) as c:
        assert c.get("/dicomweb/studies").json() == []


def test_cors_headers(settings) -> None:
    with TestClient(create_app(settings)) as c:
        r = c.options("/api/health", headers={"Origin": "http://localhost:5173",
                                                "Access-Control-Request-Method": "GET"})
        assert r.headers["access-control-allow-origin"] == "http://localhost:5173"
