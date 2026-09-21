from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import health
from app.config import Settings, get_settings
from app.db import connect, init_schema
from app.dicomweb import qido


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(title="DICOM 3D Web Viewer API")
    app.state.settings = settings
    conn = connect(settings.db_path)
    init_schema(conn)
    app.state.db = conn
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["X-Sort-Method", "Content-Length"],
    )
    app.include_router(health.router)
    app.include_router(qido.router)
    return app


app = create_app()
