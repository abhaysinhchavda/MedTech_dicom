from __future__ import annotations

import sqlite3

from fastapi import Request

from app.config import Settings

DICOM_JSON = "application/dicom+json"


def get_db(request: Request) -> sqlite3.Connection:
    return request.app.state.db  # type: ignore[no-any-return]


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings  # type: ignore[no-any-return]
