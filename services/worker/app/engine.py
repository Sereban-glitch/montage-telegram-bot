"""Адаптер движка Sereban-glitch-video-montage v2.0.0.

Воркер не изобретает монтаж заново — он готовит рабочую папку задачи,
генерирует конфиги ТОЧНО в формате движка (templates/*.example.json из репозитория)
и вызывает скрипты движка через subprocess.

ВАЖНО (адаптер): имена флагов CLI ниже соответствуют конфиг-формату
v2.0.0 (templates/short.config.example.json, long.config.example.json,
thumbnail.short.example.json, metadata.example.json, profiles/<key>.json).
Если в вашем клоне скрипт принимает другой флаг (например, --config),
поправьте только ENGINE_COMMANDS ниже — остальной код не меняется.
"""
import json
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

from .config import get_settings

# P0: аппаратное кодирование (детект один раз, кэш)
from . import hwaccel

# ----------------------------------------------------------------
# Контракты вызова скриптов движка (меняются в одном месте)
# ----------------------------------------------------------------
ENGINE_COMMANDS = {
    "render_short": "python scripts/short/render_short.py --config {config}",
    "thumb_short": "python scripts/short/thumb_short.py --config {config}",
    "audit_gaps": "python scripts/long/audit_gaps.py --config {config}",
    "render_segments": "python scripts/long/render_segments.py --config {config}",
    "publish_youtube": "python scripts/publish/upload_youtube.py --config {config}",
}


@dataclass
class ShortParams:
    title_line1: str = ""
    title_line2: str = ""
    overlay_label: str = ""
    pill_text: str = ""
    speech_lang: str = "uk"
    subtitle_lang: str = "ru"
    bilingual: bool = True
    cover_frame: int = 35
    # ── P1–P3 (апгрейд-2026): улучшения монтажа ──
    remove_silence: bool = True   # ✂️ silencedetect -38 dB / 450 мс
    sfx: bool = False             # 🥁 лёгкие акценты на склейках
    music: bool = False           # 🎵 фон с sidechain-дакингом
    dub: bool = False             # 🗣 RU⇄UA через edge-tts + LLM


@dataclass
class LongParams:
    max_gap: float = 3.0
    pad: float = 0.6
    whisper_model: str = "large-v3-turbo"
    chapters: bool = True
    meta_title: str = ""


@dataclass
class Segment:
    start: float
    end: float
    text: str


@dataclass
class Workspace:
    """Рабочая папка задачи /data/media/<job_id>/ — полная файловая изоляция."""

    job_id: str
    root: Path
    profile: str = field(default="")

    @classmethod
    def for_job(cls, job_id: str) -> "Workspace":
        root = Path(get_settings().media_dir) / job_id
        root.mkdir(parents=True, exist_ok=True)
        return cls(job_id=job_id, root=root, profile=get_settings().default_profile)

    @property
    def source(self) -> Path:
        for cand in sorted(self.root.glob("source.*")):
            return cand
        raise FileNotFoundError("source.* не найден — загрузка не выполнена")

    @property
    def audio(self) -> Path:
        return self.root / "audio16k.wav"

    @property
    def transcript(self) -> Path:
        return self.root / "transcript.json"

    @property
    def final(self) -> Path:
        return self.root / "final.mp4"

    @property
    def thumbnail(self) -> Path:
        return self.root / "thumbnail.jpg"

    # ---------------- Конфиги формата движка ----------------

    def write_short_config(self, edits: list[list[float]], captions: list[list]) -> Path:
        cfg = {
            "source": str(self.source),
            "output": str(self.final),
            "ass_path": str(self.root / "subtitles.ass"),
            "profile": self.profile,
            "subtitle_size": 50,
            "subtitle_max_width": 960,
            "overlay": {
                "label": self._short.overlay_label or "КСУ",
                "title": [x for x in (self._short.title_line1, self._short.title_line2) if x],
            },
            "edits": edits,
            "captions": captions,
        }
        path = self.root / "short.config.json"
        path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def write_thumb_short_config(self) -> Path:
        s = self._short
        cfg = {
            "background": str(self.thumbnail_frame),
            "output": str(self.thumbnail),
            "label": s.overlay_label or "КСУ",
            "title_lines": [x.upper() for x in (s.title_line1, s.title_line2) if x],
            "subline": "",
            "pill_text": s.pill_text or "",
            "zoom": 1.25,
            "focus_y": max(0.0, min(1.0, s.cover_frame / 100)),
        }
        path = self.root / "thumbnail.short.json"
        path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def write_long_config(self) -> Path:
        s = self._long
        cfg = {
            "source": str(self.source),
            "audio": str(self.audio),
            "transcript": str(self.transcript),
            "clean_transcript": str(self.root / "transcript_clean.json"),
            "language": "uk",
            "whisper_model": s.whisper_model,
            "whisper_compute": "int8",
            "cpu_threads": 4,
            "beam_size": 5,
            "audit_min_gap": 5.0,
            "audit_model": "small",
            "max_gap": s.max_gap,
            "pad": s.pad,
            "subtitle": {
                "font": "DejaVu Sans",
                "size": 34,
                "margin_l": 60,
                "margin_r": 60,
                "margin_v": 36,
                "outline": 2.2,
                "shadow": 0.8,
                "max_chars": 84,
                "max_line_chars": 44,
            },
            "render": {
                "threads": 2,
                "filter_threads": 1,
                "preset": "veryfast",
                "crf": 21,
                # P0 (апгрейд-2026): аппаратное кодирование VAAPI — движок v2.0.1+
                # читает эти ключи; старые версии безопасно игнорируют неизвестные поля
                "hwaccel": hwaccel.hw_name(),
                "encoder": "h264_vaapi" if hwaccel.detect() == "vaapi" else "libx264",
                "audio_bitrate": "160k",
                "audio_rate": 48000,
                "audio_channels": 2,
            },
        }
        path = self.root / "long.config.json"
        path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    def write_metadata(self, title: str, description: str, tags: list[str]) -> Path:
        cfg = {
            "title": title,
            "description": description,
            "tags": tags,
            "categoryId": "25",
            "defaultLanguage": "uk",
            "defaultAudioLanguage": "uk",
            "privacyStatus": "private",  # ТЗ: публикация всегда private
            "selfDeclaredMadeForKids": False,
            "embeddable": True,
        }
        path = self.root / "metadata.json"
        path.write_text(json.dumps(cfg, ensure_ascii=False, indent=2), encoding="utf-8")
        return path

    # ---------------- Вызов движка ----------------

    def run_engine(self, action: str, config_path: Path, timeout: int | None = None) -> None:
        """subprocess-вызов скрипта движка; dry_run для проверок без клона репозитория."""
        if get_settings().dry_run:
            print(f"[dry-run] {action}: {ENGINE_COMMANDS[action].format(config=config_path)}")
            return
        repo = Path(get_settings().engine_repo)
        if not repo.exists():
            raise RuntimeError(f"Репозиторий движка не найден: {repo} (соберите образ воркера по DEPLOYMENT.md)")
        cmd = ENGINE_COMMANDS[action].format(config=config_path)
        result = subprocess.run(
            cmd,
            shell=True,
            cwd=str(repo),
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        if result.returncode != 0:
            tail = (result.stderr or result.stdout)[-1500:]
            raise RuntimeError(f"Движок ({action}) вернул код {result.returncode}:\n{tail}")

    # Внутренние хранилища параметров задачи
    _short: ShortParams = field(default_factory=ShortParams)
    _long: LongParams = field(default_factory=LongParams)
    thumbnail_frame: Path | None = None
