from __future__ import annotations

import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS study (
  study_uid TEXT PRIMARY KEY,
  patient_name TEXT, patient_id TEXT, study_date TEXT, study_time TEXT,
  study_desc TEXT, accession TEXT, modalities TEXT
);
CREATE TABLE IF NOT EXISTS series (
  series_uid TEXT PRIMARY KEY,
  study_uid TEXT NOT NULL REFERENCES study(study_uid),
  modality TEXT, series_desc TEXT, series_number INTEGER,
  instance_count INTEGER DEFAULT 0, frame_count INTEGER DEFAULT 0,
  thumb_sop_uid TEXT, sort_method TEXT,
  is_volume INTEGER DEFAULT 0, volume_reason TEXT,
  dim_x INTEGER, dim_y INTEGER, dim_z INTEGER,
  spacing_x REAL, spacing_y REAL, spacing_z REAL,
  origin_x REAL, origin_y REAL, origin_z REAL, direction TEXT
);
CREATE TABLE IF NOT EXISTS instance (
  sop_uid TEXT PRIMARY KEY,
  series_uid TEXT NOT NULL REFERENCES series(series_uid),
  instance_number INTEGER, rows INTEGER, cols INTEGER,
  bits_allocated INTEGER, pixel_representation INTEGER, samples_per_pixel INTEGER,
  num_frames INTEGER,
  ipp_x REAL, ipp_y REAL, ipp_z REAL, iop TEXT, pixel_spacing TEXT,
  path TEXT NOT NULL, transfer_syntax TEXT
);
CREATE INDEX IF NOT EXISTS ix_series_study ON series(study_uid);
CREATE INDEX IF NOT EXISTS ix_instance_series ON instance(series_uid);
"""


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn


def init_schema(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()
