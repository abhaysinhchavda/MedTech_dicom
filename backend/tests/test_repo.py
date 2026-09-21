from pathlib import Path

from app import repo
from app.db import connect, init_schema
from app.models import InstanceRow, SeriesRow, StudyRow, VolumeInfo


def _conn(tmp_path: Path):
    c = connect(tmp_path / "x.sqlite")
    init_schema(c)
    return c


def _study(uid="S1") -> StudyRow:
    return StudyRow(uid, "Doe^J", "P1", "20240101", "1200", "desc", "ACC", ["CT"])


def _series(uid="SE1", study="S1") -> SeriesRow:
    return SeriesRow(uid, study, "CT", "sdesc", 3)


def _inst(uid="I1", series="SE1", inst=1) -> InstanceRow:
    return InstanceRow(
        uid,
        series,
        inst,
        16,
        16,
        16,
        1,
        1,
        1,
        (0.0, 0.0, float(inst)),
        (1, 0, 0, 0, 1, 0),
        (0.5, 0.5),
        f"/tmp/{uid}.dcm",
        "1.2.840.10008.1.2.1",
    )


def test_roundtrip_and_upsert(tmp_path: Path) -> None:
    c = _conn(tmp_path)
    repo.upsert_study(c, _study())
    repo.upsert_series(c, _series())
    repo.upsert_instance(c, _inst())
    repo.upsert_instance(c, _inst())  # idempotent
    assert repo.get_study(c, "S1") == _study()
    assert repo.get_series(c, "SE1").series_desc == "sdesc"
    assert repo.list_instances(c, "SE1") == [_inst()]
    assert repo.get_instance(c, "I1") == _inst()
    assert repo.count_series_and_instances(c, "S1") == (1, 1)


def test_finalize_writes_volume_columns(tmp_path: Path) -> None:
    c = _conn(tmp_path)
    repo.upsert_study(c, _study())
    repo.upsert_series(c, _series())
    repo.upsert_instance(c, _inst())
    v = VolumeInfo(
        True, None, (16, 16, 3), (0.5, 0.5, 1.0), (0.0, 0.0, 0.0), (1, 0, 0, 0, 1, 0, 0, 0, 1)
    )
    repo.update_series_finalized(
        c, "SE1", instance_count=3, thumb_sop_uid="I1", sort_method="geometry", volume=v
    )
    s = repo.get_series(c, "SE1")
    assert s.instance_count == 3 and s.thumb_sop_uid == "I1" and s.sort_method == "geometry"
    assert s.volume == v


def test_upsert_series_does_not_clobber_finalized_columns(tmp_path: Path) -> None:
    c = _conn(tmp_path)
    repo.upsert_study(c, _study())
    repo.upsert_series(c, _series())
    repo.upsert_instance(c, _inst())
    v = VolumeInfo(
        True, None, (16, 16, 3), (0.5, 0.5, 1.0), (0.0, 0.0, 0.0), (1, 0, 0, 0, 1, 0, 0, 0, 1)
    )
    repo.update_series_finalized(
        c, "SE1", instance_count=3, thumb_sop_uid="I1", sort_method="geometry", volume=v
    )
    repo.upsert_series(c, SeriesRow("SE1", "S1", "MR", "renamed", 9))
    s = repo.get_series(c, "SE1")
    assert s.modality == "MR"
    assert s.series_desc == "renamed"
    assert s.series_number == 9
    assert s.instance_count == 3
    assert s.thumb_sop_uid == "I1"
    assert s.sort_method == "geometry"
    assert s.volume == v


def test_list_studies_filters(tmp_path: Path) -> None:
    c = _conn(tmp_path)
    repo.upsert_study(c, _study("A"))
    repo.upsert_study(c, StudyRow("B", "Roe^R", "P2", "20230505", None, None, None, ["MR"]))
    assert [s.study_uid for s in repo.list_studies(c, patient_name="doe")] == ["A"]
    assert [s.study_uid for s in repo.list_studies(c, patient_id="P2")] == ["B"]
    assert [s.study_uid for s in repo.list_studies(c, study_date="20230505")] == ["B"]
    assert (
        len(repo.list_studies(c, limit=1)) == 1
        and len(repo.list_studies(c, limit=1, offset=1)) == 1
    )
