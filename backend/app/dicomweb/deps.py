from __future__ import annotations

import sqlite3
from collections.abc import Iterator

from fastapi import Request

from app.config import Settings
from app.db import connect

DICOM_JSON = "application/dicom+json"


def get_db(request: Request) -> Iterator[sqlite3.Connection]:
    # One connection per request, not the shared `app.state.db` connection:
    # sqlite3.Connection objects are not safe for concurrent use by multiple
    # threads (see app/db.py::connect), and FastAPI dispatches both sync
    # dependencies and sync endpoint bodies onto a worker threadpool -- often
    # onto *different* threads for the same request, and onto arbitrary
    # threads across concurrent requests. Handing out app.state.db here would
    # let two in-flight requests call into the very same connection object at
    # the same time. Opening a fresh connection per request instead means each
    # one is exclusively owned by a single request end-to-end, regardless of
    # which worker thread(s) FastAPI happens to run it on; WAL mode (set in
    # `connect`) then lets any number of these read concurrently for free.
    # This previously surfaced as `sqlite3.InterfaceError` from
    # `app/repo.py::get_instance` under concurrent WADO-RS frame requests.
    conn = connect(request.app.state.settings.db_path)
    try:
        yield conn
    finally:
        conn.close()


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings  # type: ignore[no-any-return]
