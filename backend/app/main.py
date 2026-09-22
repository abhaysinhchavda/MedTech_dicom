"""Entry point: run with uvicorn's factory mode, e.g.

    uvicorn app.main:create_app --factory --reload --port 8001

There is deliberately no module-level `app = create_app()` here: that would call
get_settings() and open the real db at *import* time (e.g. on every pytest collection),
bypassing the lifespan startup/shutdown hooks entirely.
"""

from __future__ import annotations

import logging
import weakref
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health, upload, volume
from app.config import Settings, get_settings
from app.db import connect, init_schema
from app.dicomweb import qido, wado
from app.ingest.indexer import ingest_directory

log = logging.getLogger("dicomviewer")


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if settings.samples_dir.is_dir():
            summary = ingest_directory(app.state.db, settings.samples_dir, settings.store_dir)
            log.info(
                "samples ingested: %d accepted, %d skipped",
                summary.accepted,
                len(summary.skipped),
            )
        yield
        app.state.db.close()

    app = FastAPI(title="DICOM 3D Web Viewer API", lifespan=lifespan)
    app.state.settings = settings
    conn = connect(settings.db_path)
    init_schema(conn)
    app.state.db = conn
    # The connection above is opened eagerly (not inside `lifespan`) so that
    # app.state.db is available to callers -- notably tests -- that build an
    # app via create_app() but never run it through the ASGI lifespan (that
    # only happens with `with TestClient(...) as c:`, not a bare TestClient()).
    # `lifespan`'s shutdown closes it for apps that ARE run as ASGI; this
    # finalizer is the backstop for the ones that aren't, so the connection
    # (and its sqlite WAL file handles) don't leak until process exit. Closing
    # an already-closed sqlite3.Connection is a harmless no-op, so this never
    # conflicts with the lifespan's own close().
    #
    # This connection is used only here (single-threaded startup ingestion)
    # and directly by tests that seed data out of band; request handlers never
    # see it. app/dicomweb/deps.py::get_db opens its own private connection
    # per request instead, because sqlite3.Connection objects aren't safe for
    # concurrent use by multiple threads -- see that module for why.
    weakref.finalize(app, conn.close)
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"],
        allow_headers=["*"], expose_headers=["X-Sort-Method", "Content-Length"],
    )
    for r in (health.router, volume.router, upload.router, qido.router, wado.router):
        app.include_router(r)
    return app
