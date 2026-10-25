"""P1/P2: Фоновая музыка с автоприглушением под голос (sidechain ducking).

Источники музыки — без лицензионных рисков:
  1) владелец кладёт СВОИ треки в /data/music/*.mp3 (CC0/royalty-free);
  2) если каталог пуст — синтезируем мягкий процедурный подклад (aevalsrc,
     минорное трезвучие + медленный LFO), заведомо «наш» звук.

Ducking: классический sidechaincompress — музыка сжимается сигналом голоса
(threshold=0.03, ratio=6, attack=5 мс, release=300 мс), как в подкаст-студиях.
Видео-дорожка копируется без перекодирования.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

MUSIC_GAIN_DB = -13.0  # музыка сама по себе заметно тише голоса


def build_duck_filter(music_gain_db: float = MUSIC_GAIN_DB) -> str:
    """Лавграф: [1:a] музыка → компрессия сайдчейном голоса → amix с голосом."""
    return (
        f"[1:a]volume={music_gain_db}dB,aloop=loop=-1:size=2e+09[bg];"
        "[0:a]asplit=2[voice][sc];"
        "[bg][sc]sidechaincompress=threshold=0.03:ratio=6:attack=5:release=300[duck];"
        "[voice][duck]amix=inputs=2:duration=first:normalize=0[aout]"
    )


def duck_cmd(video: Path, music: Path, out: Path,
             music_gain_db: float = MUSIC_GAIN_DB) -> list[str]:
    """ffmpeg-команда наложения приглушаемой музыки (видео — stream copy)."""
    return [
        "ffmpeg", "-y",
        "-i", str(video), "-i", str(music),
        "-filter_complex", build_duck_filter(music_gain_db),
        "-map", "0:v", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest", str(out),
    ]


def procedural_bed(dur: float, out: Path) -> Path:
    """Синтезировать тихий эмбиент-подклад (Am-трезвучие + медленное дыхание).

    Полностью «наш» звук: три синусоиды (110/164.8/220 Гц) с LFO-громкостью.
    Ни одной внешней записи → нулевые лицензионные вопросы.
    """
    expr = (
        "0.05*sin(2*PI*110*t)+0.04*sin(2*PI*164.81*t)+0.035*sin(2*PI*220*t)"
        "*(0.7+0.3*sin(2*PI*0.08*t))"
    )
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi",
         "-i", f"aevalsrc={expr}:s=44100:d={dur:.2f}",
         "-ar", "44100", "-ac", "2", str(out)],
        capture_output=True, text=True, check=True, timeout=120,
    )
    return out


def pick_music(music_dir: Path, duration: float, workdir: Path) -> Path | None:
    """Первая песня из /data/music (владелеческие CC0-треки) или процедурный подклад."""
    if music_dir.exists():
        tracks = sorted(music_dir.glob("*.mp3")) + sorted(music_dir.glob("*.m4a"))
        if tracks:
            return tracks[0]
    try:
        return procedural_bed(max(10.0, duration + 2.0), workdir / "music_bed.wav")
    except subprocess.SubprocessError:
        return None


def apply_music(video: Path, music_dir: Path, workdir: Path) -> Path:
    """Подмешать музыку к ролику → <stem>_music.mp4 (или вернуть как было)."""
    import json

    dur = 60.0
    try:  # реальную длительность достаём ffprobe
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration",
             "-of", "json", str(video)],
            capture_output=True, text=True, timeout=30,
        )
        dur = float(json.loads(probe.stdout)["format"]["duration"])
    except (subprocess.SubprocessError, KeyError, ValueError):
        pass
    music = pick_music(music_dir, dur, workdir)
    if music is None:
        return video
    out = video.with_name(video.stem + "_music.mp4")
    subprocess.run(duck_cmd(video, music, out), check=True,
                   capture_output=True, text=True, timeout=900)
    return out
