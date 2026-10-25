"""P1: Реальная вырезка пауз — ffmpeg silencedetect → уточнённый план монтажа.

Открытые источники: auto-editor (Public Domain) вырезает тишину с порогом
≈ -38 dB и минимальной длительностью 0.3–0.5 c; мы применяем ту же идею
к окнам хуков и Short-ам: паузы длиннее 450 мс вырезаются, по краям
остаётся pad 120 мс (чтобы речь не «обрубалась»).

Чистые функции (parse_silencedetect / tighten_edits / remap_captions)
покрыты unit-тестами без запуска ffmpeg.
"""
from __future__ import annotations

import re
import subprocess
from pathlib import Path

# Значения по умолчанию — по практике auto-editor / Descript «remove dead air»
THRESHOLD_DB = -38.0
MIN_DUR = 0.45
PAD = 0.12

_SILENCE_START_RE = re.compile(r"silence_start:\s*(\d+(?:\.\d+)?)")
_SILENCE_END_RE = re.compile(r"silence_end:\s*(\d+(?:\.\d+)?)\s*\|\s*silence_duration:\s*(\d+(?:\.\d+)?)")


def parse_silencedetect(log: str) -> list[tuple[float, float]]:
    """Разобрать вывод ffmpeg -af silencedetect → [(start, end), ...].

    Терпим к незакрытому последнему интервалу (обрыв лога): берём start+min_dur.
    """
    out: list[tuple[float, float]] = []
    pending_start: float | None = None
    for line in log.splitlines():
        m = _SILENCE_START_RE.search(line)
        if m:
            pending_start = float(m.group(1))
            continue
        m = _SILENCE_END_RE.search(line)
        if m and pending_start is not None:
            end = float(m.group(1))
            if end > pending_start:
                out.append((pending_start, end))
            pending_start = None
    if pending_start is not None:
        out.append((pending_start, pending_start + MIN_DUR))
    return out


def detect_silences(audio: Path, threshold_db: float = THRESHOLD_DB,
                    min_dur: float = MIN_DUR) -> list[tuple[float, float]]:
    """Прогнать ffmpeg silencedetect по аудио и вернуть интервалы тишины."""
    proc = subprocess.run(
        ["ffmpeg", "-hide_banner", "-nostats", "-i", str(audio),
         "-af", f"silencedetect=noise={threshold_db}dB:d={min_dur}",
         "-f", "null", "-"],
        capture_output=True, text=True, timeout=600,
    )
    return parse_silencedetect(proc.stderr or "")


def tighten_edits(edits: list[list[float]], silences: list[tuple[float, float]],
                  pad: float = PAD, min_keep: float = 0.25) -> list[list[float]]:
    """Вычесть из монтажных интервалов куски тишины (с pad по краям).

    edits: [[s, e], ...] — исходный план (например, [[0, dur]] для хука).
    Возвращает уточнённый план: та же хронология, но без пауз внутри.
    """
    out: list[list[float]] = []
    for s, e in edits:
        cursor = s
        for ss, se in silences:
            if se <= s or ss >= e:
                continue  # тишина вне текущего интервала
            cut_s, cut_e = max(ss - pad, s), min(se + pad, e)
            if cut_e <= cut_s:
                continue
            if cut_s - cursor >= min_keep:
                out.append([round(cursor, 3), round(cut_s, 3)])
            cursor = max(cursor, cut_e)
        if e - cursor >= min_keep:
            out.append([round(cursor, 3), round(e, 3)])
    return out or edits  # страховка: полный вырез → оставляем как было


def remap_captions(captions: list[list], silences: list[tuple[float, float]],
                   pad: float = PAD) -> list[list]:
    """Сдвинуть таймкоды субтитров после вырезки пауз (линейный сдвиг).

    captions: [[start, end, text], ...] в исходной шкале времени.
    Субтитр, целиком попавший в вырез, отбрасывается (его не слышно).
    """
    cuts = [(max(0.0, ss - pad), se + pad) for ss, se in silences]

    def shift(t: float) -> float:
        delta = 0.0
        for cs, ce in cuts:
            if ce <= t:
                delta += ce - cs
            elif cs < t:
                delta += t - cs  # точка внутри выреза → прижимаем к его началу
        return round(t - delta, 3)

    out: list[list] = []
    for row in captions:
        s, e, text = float(row[0]), float(row[1]), row[2]
        # доля субтитра, попавшая в вырезы
        covered = sum(
            max(0.0, min(e, ce) - max(s, cs)) for cs, ce in cuts
        )
        span = max(0.001, e - s)
        if covered / span > 0.7:
            continue  # практически вся реплика — тишина
        ns, ne = shift(s), shift(e)
        if ne - ns >= 0.15:
            out.append([ns, ne, text])
    return out


def cut_duration(edits: list[list[float]]) -> float:
    """Суммарная длительность монтажного плана (для логов)."""
    return round(sum(e - s for s, e in edits), 2)
