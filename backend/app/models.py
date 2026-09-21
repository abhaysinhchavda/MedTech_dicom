from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

SortMethod = Literal["geometry", "instance-number", "filename"]


@dataclass(frozen=True)
class InstanceRow:
    sop_uid: str
    series_uid: str
    instance_number: int | None
    rows: int
    cols: int
    bits_allocated: int
    pixel_representation: int
    samples_per_pixel: int
    num_frames: int
    ipp: tuple[float, float, float] | None
    iop: tuple[float, float, float, float, float, float] | None
    pixel_spacing: tuple[float, float] | None
    path: str
    transfer_syntax: str


@dataclass(frozen=True)
class VolumeInfo:
    is_volume: bool
    reason: str | None = None
    dims: tuple[int, int, int] | None = None
    spacing: tuple[float, float, float] | None = None
    origin: tuple[float, float, float] | None = None
    direction: tuple[float, ...] | None = None  # 9 floats: row, col, normal cosines


@dataclass(frozen=True)
class SeriesRow:
    series_uid: str
    study_uid: str
    modality: str | None
    series_desc: str | None
    series_number: int | None
    instance_count: int = 0
    thumb_sop_uid: str | None = None
    sort_method: SortMethod | None = None
    volume: VolumeInfo = field(default_factory=lambda: VolumeInfo(False, "not finalized"))


@dataclass(frozen=True)
class StudyRow:
    study_uid: str
    patient_name: str | None
    patient_id: str | None
    study_date: str | None
    study_time: str | None
    study_desc: str | None
    accession: str | None
    modalities: list[str]


@dataclass(frozen=True)
class SkippedFile:
    file: str
    reason: str


@dataclass
class IngestSummary:
    accepted: int = 0
    skipped: list[SkippedFile] = field(default_factory=list)
    study_uids: list[str] = field(default_factory=list)
