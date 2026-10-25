"""P1: Лёгкие SFX-акценты на склейках — процедурная генерация (CC0-эквивалент).

Никаких внешних ассетов и лицензий: whoosh/impact/riser синтезируются самим
ffmpeg (розовый шум + огибающие, синусоиды с быстрым затуханием). Это «из
коробки» работает на любом воркере и не нарушает лицензионную гигиену.

Громкости специально низкие (-22 LUFS относительно голоса): SFX лишь
подчёркивают смену плана, как у топовых Shorts-блогеров, и никогда
не заглушают речь.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

SFX_KINDS = ("whoosh", "impact", "riser")

# Генераторы ffmpeg (лавграф без входных файлов)
_SYNTH = {
    "whoosh": (
        "anoisesrc=color=pink:duration={dur}:seed={seed}:amplitude=0.25,"
        "lowpass=f=2400,afade=t=in:st=0:d={fade_in},"
        "afade=t=out:st={fade_out_st}:d={fade_out},volume=0.5"
    ),
    "impact": (
        "sine=frequency=64:duration={dur},"
        "afade=t=out:st=0.04:d={fade_out},volume=0.9;"
        "sine=frequency=110:duration={dur},"
        "afade=t=out:st=0.02:d={fade_out},volume=0.35"
    ),
    "riser": (
        "sine=frequency=440:duration={dur},"
        "vibrato=f=7:d=0.6,afade=t=in:st=0:d={fade_in},volume=0.4"
    ),
}


def sfx_plan(edits: list[list[float]], max_items: int = 8) -> list[dict]:
    """Расстановка акцентов: на старте каждого монтажного куска, чередуя типы.

    edits: [[s, e], ...] — план монтажа (после tighten_edits).
    Возвращает [{'kind': 'whoosh', 'at': 12.4}, ...] — позиции в ИСХОДНОЙ шкале.
    """
    plan: list[dict] = []
    kinds_cycle = ("whoosh", "whoosh", "impact")
    for i, (s, _e) in enumerate(edits):
        if i == 0:
            continue  # самый первый кадр — без акцента, не мешаем хуку
        if len(plan) >= max_items:
            break
        plan.append({"kind": kinds_cycle[i % len(kinds_cycle)], "at": round(float(s), 3)})
    return plan


def synth_sfx(out: Path, kind: str, seed: int = 42) -> Path:
    """Сгенерировать один SFX-файл (wav, 44.1 kHz mono)."""
    if kind not in SFX_KINDS:
        raise ValueError(f"Неизвестный SFX: {kind}")
    dur = 0.35 if kind == "impact" else 0.6
    fade_in = 0.12 if kind == "whoosh" else dur * 0.8
    fade_out = dur - fade_in if kind == "whoosh" else dur * 0.7
    graph = _SYNTH[kind].format(
        dur=dur, seed=seed, fade_in=fade_in, fade_out=fade_out,
        fade_out_st=max(0.0, dur - fade_out),
    )
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", graph,
         "-ar", "44100", "-ac", "1", str(out)],
        capture_output=True, text=True, check=True, timeout=60,
    )
    return out


def build_mix_cmd(video: Path, sfx_files: list[Path], delays_ms: list[int],
                  out: Path) -> list[str]:
    """Команда смешивания: голос + N SFX с задержками, видео копируется без
    перекодирования (SFX — только аудио-слой, качество видео не трогаем)."""
    if len(sfx_files) != len(delays_ms) or not sfx_files:
        raise ValueError("sfx_files и delays_ms должны быть непустыми и равной длины")
    cmd: list[str] = ["ffmpeg", "-y", "-i", str(video)]
    for f in sfx_files:
        cmd += ["-i", str(f)]
    n = len(sfx_files)
    parts = []
    for i, delay in enumerate(delays_ms):
        # mono-дорожки: adelay принимает мс на канал, all=1 применяет ко всем
        parts.append(f"[{i + 1}:a]adelay={delay}:all=1[s{i}]")
    labels = "".join(f"[s{i}]" for i in range(n))
    filter_complex = (
        ";".join(parts)
        + f";[0:a]{labels}amix=inputs={n + 1}:normalize=0:weights=1 "
        + " ".join("0.22" for _ in range(n))
        + "[aout]"
    )
    cmd += ["-filter_complex", filter_complex, "-map", "0:v", "-map", "[aout]",
            "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-shortest", str(out)]
    return cmd


def mix_sfx(video: Path, plan: list[dict], workdir: Path, seed: int = 42) -> Path:
    """Синтезировать и подмешать SFX к видео → <stem>_sfx.mp4 (или копия)."""
    if not plan:
        return video
    files: list[Path] = []
    delays: list[int] = []
    for i, item in enumerate(plan):
        f = workdir / f"sfx_{item['kind']}_{i}.wav"
        synth_sfx(f, item["kind"], seed=seed + i)
        files.append(f)
        delays.append(int(item["at"] * 1000))
    out = video.with_name(video.stem + "_sfx.mp4")
    subprocess.run(build_mix_cmd(video, files, delays, out), check=True,
                   capture_output=True, text=True, timeout=600)
    return out
