"""P0: Аппаратное кодирование VAAPI (Intel iHD / AMD Mesa) с автофолбэком на libx264.

Ноутбук-воркер (Linux Mint, 12 ГБ) обычно имеет интегрированную графику Intel —
рендер H.264 через h264_vaapi быстрее libx264 в 3–5 раз и не занимает CPU
(Whisper может работать параллельно). Модуль детектирует VAAPI один раз
(lru_cache) и отдаёт готовые аргументы ffmpeg:

    hwaccel.detect()            -> "vaapi" | None
    hwaccel.encoder_args(21)    -> ["-c:v", "h264_vaapi", ...] | ["-c:v", "libx264", ...]
    hwaccel.input_hw_args()     -> префикс декодера в vaapi-пиксели
    hwaccel.scale_filter(960)   -> "scale_vaapi=-2:960:format=nv12" | "scale=-2:960"

Правила отключения: env MONTAGE_HWACCEL=off / нет /dev/dri/renderD128 /
нет vainfo / vainfo не видит профиля H.264 → тихий фолбэк на ПО.
ОЗУ: +0 МБ (драйвер уже загружен в ядро).
"""
from __future__ import annotations

import os
import shutil
import subprocess
from functools import lru_cache

RENDER_DEVICE = "/dev/dri/renderD128"


@lru_cache(maxsize=1)
def detect() -> str | None:
    """Вернуть 'vaapi' при рабочем VA-API, иначе None (софтверный фолбэк)."""
    if os.getenv("MONTAGE_HWACCEL", "").strip().lower() in ("0", "off", "no", "false"):
        return None
    if not os.path.exists(RENDER_DEVICE):
        return None
    if not shutil.which("vainfo"):
        return None  # mesa-va-drivers не установлены — не падаем, кодируем на CPU
    try:
        proc = subprocess.run(
            ["vainfo", "--display", "drm", "--device", RENDER_DEVICE],
            capture_output=True, text=True, timeout=20,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    out = (proc.stdout or "") + (proc.stderr or "")
    if proc.returncode != 0 or "VA-API version" not in out:
        return None
    if "H.264" not in out and "H264" not in out:
        return None  # декодер есть, энкодера нет (редко) — фолбэк
    return "vaapi"


def hw_name() -> str:
    """Короткое имя для логов/конфигов: 'vaapi' | 'off'."""
    return detect() or "off"


def encoder_args(crf: int = 21) -> list[str]:
    """Аргументы видеокодера. VAAPI: CQP ~ crf; софт: preset veryfast."""
    if detect() == "vaapi":
        return [
            "-c:v", "h264_vaapi",
            "-rc_mode", "CQP",
            "-global_quality", str(crf),
            "-bf", "2",
        ]
    return ["-c:v", "libx264", "-preset", "veryfast", "-crf", str(crf), "-pix_fmt", "yuv420p"]


def input_hw_args() -> list[str]:
    """Префикс входа: декодировать сразу в vaapi-пиксели (hwaccel→hwencode)."""
    if detect() == "vaapi":
        return [
            "-hwaccel", "vaapi",
            "-hwaccel_output_format", "vaapi",
            "-vaapi_device", RENDER_DEVICE,
        ]
    return []


def scale_filter(height: int = 960) -> str:
    """Фильтр масштабирования в пикселях текущего контекста (vaapi/soft)."""
    if detect() == "vaapi":
        return f"scale_vaapi=-2:{height}:format=nv12"
    return f"scale=-2:{height}"
