from pathlib import Path

import numpy as np
import pydicom

from app import repo
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
    d1 = make_ct_series(2)
    for ds in d1:
        ds.PatientName, ds.PatientID, ds.StudyDate = "Alpha^A", "P100", "20230101"
    d2 = make_ct_series(2)
    for ds in d2:
        ds.PatientName, ds.PatientID, ds.StudyDate = "Beta^B", "P200", "20230202"
    write_series(d1, tmp_path / "in1")
    write_series(d2, tmp_path / "in2")
    ingest_directory(client.app.state.db, tmp_path / "in1", client.app.state.settings.store_dir)
    ingest_directory(client.app.state.db, tmp_path / "in2", client.app.state.settings.store_dir)

    assert client.get("/dicomweb/studies", params={"PatientName": "nobody"}).json() == []

    by_name = client.get("/dicomweb/studies", params={"PatientName": "Alpha"}).json()
    assert len(by_name) == 1 and by_name[0]["0020000D"]["Value"] == [d1[0].StudyInstanceUID]

    by_id = client.get("/dicomweb/studies", params={"PatientID": "P200"}).json()
    assert len(by_id) == 1 and by_id[0]["0020000D"]["Value"] == [d2[0].StudyInstanceUID]

    by_date = client.get("/dicomweb/studies", params={"StudyDate": "20230101"}).json()
    assert len(by_date) == 1 and by_date[0]["0020000D"]["Value"] == [d1[0].StudyInstanceUID]

    # A literal "%" in the filter must be escaped, not treated as a LIKE
    # wildcard -- otherwise this matches every patient name and returns both
    # studies instead of none.
    assert client.get("/dicomweb/studies", params={"PatientName": "%"}).json() == []

    assert client.get("/dicomweb/studies", params={"limit": 1, "offset": 5}).json() == []


def test_series_related_instances_counts_instances_not_frames(client, tmp_path: Path) -> None:
    # A single instance with 4 frames must report instanceCount == 1 everywhere
    # (QIDO 0020,1209 and 0020,1208, and volume-info.instanceCount) even though
    # it has 4 frames. Multi-frame series aren't volumes in v1 (see
    # test_geometry.py::test_multiframe_counts_frames, unchanged here), so
    # volume-info.dims stays null -- frame_count is where the "4" surfaces.
    (ds,) = make_ct_series(1)
    ds.NumberOfFrames = 4
    ds.PixelData = np.stack(
        [np.full((16, 16), k, dtype=np.int16) for k in range(4)]
    ).tobytes()
    in_dir = tmp_path / "in"
    in_dir.mkdir(parents=True, exist_ok=True)
    pydicom.dcmwrite(in_dir / "img0000.dcm", ds, enforce_file_format=True)
    ingest_directory(client.app.state.db, in_dir, client.app.state.settings.store_dir)

    study_j = client.get("/dicomweb/studies").json()[0]
    assert study_j["00201208"]["Value"] == [1]

    series_j = client.get(f"/dicomweb/studies/{ds.StudyInstanceUID}/series").json()[0]
    assert series_j["00201209"]["Value"] == [1]

    vol = client.get(f"/api/series/{ds.SeriesInstanceUID}/volume-info").json()
    assert vol["instanceCount"] == 1

    s = repo.get_series(client.app.state.db, ds.SeriesInstanceUID)
    assert s.frame_count == 4


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
