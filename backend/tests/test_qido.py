from pathlib import Path

from app.ingest.indexer import ingest_directory
from tests.conftest import make_ct_series, write_series

DJ = "application/dicom+json"


def _seed(client, tmp_path: Path, n=4, **kw):
    dsets = make_ct_series(n, **kw)
    write_series(dsets, tmp_path / "in")
    ingest_directory(client.app.state.db, tmp_path / "in", client.app.state.settings.store_dir)
    return dsets


def test_studies_list(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path)
    r = client.get("/dicomweb/studies")
    assert r.status_code == 200 and r.headers["content-type"].startswith(DJ)
    (s,) = r.json()
    assert s["0020000D"]["Value"] == [d[0].StudyInstanceUID]
    assert s["00100010"]["Value"] == [{"Alphabetic": "Test^Patient"}]
    assert s["00080061"]["Value"] == ["CT"]
    assert s["00201206"]["Value"] == [1] and s["00201208"]["Value"] == [4]


def test_studies_filters_and_paging(client, tmp_path: Path) -> None:
    _seed(client, tmp_path)
    assert client.get("/dicomweb/studies", params={"PatientName": "nobody"}).json() == []
    assert len(client.get("/dicomweb/studies", params={"PatientID": "P001"}).json()) == 1
    assert client.get("/dicomweb/studies", params={"limit": 1, "offset": 5}).json() == []


def test_series_and_instances(client, tmp_path: Path) -> None:
    d = _seed(client, tmp_path)
    su, se = d[0].StudyInstanceUID, d[0].SeriesInstanceUID
    (s,) = client.get(f"/dicomweb/studies/{su}/series").json()
    assert s["0020000E"]["Value"] == [se]
    assert s["00080060"]["Value"] == ["CT"] and s["00201209"]["Value"] == [4]
    assert s["00080018"]["Value"] == [d[2].SOPInstanceUID]
    inst = client.get(f"/dicomweb/studies/{su}/series/{se}/instances").json()
    sop_uids = {i["00080018"]["Value"][0] for i in inst}
    assert len(inst) == 4 and sop_uids == {x.SOPInstanceUID for x in d}
    assert inst[0]["00280010"]["Value"] == [16]


def test_unknown_uids_404(client) -> None:
    assert client.get("/dicomweb/studies/9.9/series").status_code == 404
    assert client.get("/dicomweb/studies/9.9/series/8.8/instances").status_code == 404
