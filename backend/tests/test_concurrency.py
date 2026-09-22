from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from app.ingest.indexer import ingest_directory
from tests.conftest import make_ct_series, write_series


def test_concurrent_frame_requests_all_succeed(client, tmp_path: Path) -> None:
    """Hammer the WADO-RS frame endpoint from many threads at once.

    Regression test for the intermittent `sqlite3.InterfaceError` documented in
    task-7-report.md: the frontend's volume loader fetches many frames in
    parallel, and every request handler used to share one
    `sqlite3.Connection` (`app.state.db`, opened with
    `check_same_thread=False`). That flag only disables sqlite3's
    same-thread *ownership* check -- it does not make the underlying
    connection object safe for genuinely concurrent use by multiple OS
    threads. FastAPI dispatches sync endpoints (and sync dependencies) onto a
    worker threadpool, so concurrent frame requests really do call into the
    connection object at the same time, which can corrupt its internal
    cursor/statement state and surface as `sqlite3.InterfaceError` (or similar)
    from `app/repo.py::get_instance`.

    This test seeds a small multi-instance series and then fires many
    concurrent GETs at the per-instance frame endpoint (mirroring the volume
    loader's parallel per-slice fetch), asserting every single response is
    200. Against the pre-fix shared-connection code this is flaky/fails
    intermittently; against the fix (a private connection per request) it
    must pass every time.
    """
    n = 8
    d = make_ct_series(n)
    write_series(d, tmp_path / "in")
    ingest_directory(client.app.state.db, tmp_path / "in", client.app.state.settings.store_dir)

    base = f"/dicomweb/studies/{d[0].StudyInstanceUID}/series/{d[0].SeriesInstanceUID}"
    urls = [f"{base}/instances/{ds.SOPInstanceUID}/frames/1" for ds in d]
    # Repeat the URL list several times so many concurrent requests target
    # each connection-object-sharing hazard, not just a single lucky race.
    rounds = 12
    requests = urls * rounds

    def fetch(url: str) -> int:
        return client.get(url).status_code

    with ThreadPoolExecutor(max_workers=32) as pool:
        statuses = list(pool.map(fetch, requests))

    failures = [(url, status) for url, status in zip(requests, statuses, strict=True)
                if status != 200]
    assert not failures, f"{len(failures)}/{len(requests)} concurrent frame requests failed: " \
        f"{failures[:5]}"
