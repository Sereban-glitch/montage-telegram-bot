"""Конвейер обработки задачи: загрузка → аудио → транскрипция → рендер → обложка.

Каждая стадия честно обновляет progress/stage в БД — именно эти поля читают
Mini App («Задачи»), бот (уведомления) и админка (очередь).
"""
import json
import re
import subprocess
from pathlib import Path

from sqlalchemy import select, update

from .config import get_settings
from .db import log_event, session_factory
from .engine import LongParams, ShortParams, Segment, Workspace

# P0–P3 (апгрейд-2026): аппаратное кодирование, вырезка пауз, SFX, музыка,
# B-roll, WhisperX-адаптер и дубляж — все модули graceful-degradation
from . import broll as broll_mod
from . import dub as dub_mod
from . import hook_scorer  # 🎬 пресеты целевой длительности (target_duration)
from . import hwaccel
from . import music_duck
from . import silence_cutter
from . import sfx as sfx_mod
from . import stt as stt_mod

PROGRESS = {
    "download": (0, 8, "Загрузка видео"),
    "audio": (8, 14, "Извлечение аудио 16 кГц (ffmpeg)"),
    "transcribe": (14, 38, "Транскрипция Whisper"),
    "cut": (38, 46, "Подбор нарезки и субтитров"),
    "render": (46, 88, "Рендер сегментов"),
    "cover": (88, 96, "Обложка и метаданные"),
    "deliver": (96, 99, "Упаковка результата"),
    "done": (100, 100, "Готово — final.mp4"),
}

# Прогресс-карты новых конвейеров (Фича №1: Hook Finder; Фича №2: News Shorts)
HOOK_ANALYSIS_PROGRESS = {
    "fetch": (0, 18, "Загрузка аудиодорожки (yt-dlp, только звук)"),
    "transcribe": (18, 58, "Транскрипция Whisper с таймкодами"),
    "analyze": (58, 90, "AI Hook Scoring: хук · завершённость · эмоции · удержание"),
    "menu": (90, 100, "Меню фрагментов сформировано"),
    "done": (100, 100, "Готово — кандидаты отобраны"),
}
HOOK_RENDER_PROGRESS = {
    "fetch": (0, 22, "Скачивание фрагмента (--download-sections)"),
    "cut": (22, 32, "Субтитры фрагмента и кадр обложки"),
    "render": (32, 84, "Фирменный рендер 1080×1920 (движок)"),
    "cover": (84, 94, "Обложка и метаданные"),
    "deliver": (94, 100, "Упаковка результата"),
    "done": (100, 100, "Готово — final.mp4"),
}
NEWS_PROGRESS = {
    "script": (0, 12, "Сценарий 45 c (хук → фабула → вывод)"),
    "tts": (12, 38, "Озвучка edge-tts (украинский голос)"),
    "loudnorm": (38, 48, "Нормализация EBU R128 (-14 LUFS)"),
    "subs": (48, 58, "Караоке-субтитры (активное слово золотом)"),
    "background": (58, 66, "Фирменный фон 1080×1920"),
    "render": (66, 90, "Рендер H.264 вертикального ролика"),
    "moderation": (90, 100, "Ожидает модерации владельца"),
    "done": (100, 100, "Готово — ожидает одобрения"),
}


def set_stage(session, job_id: str, key: str, extra: str | None = None, progress: int | None = None, pmap: dict | None = None) -> None:
    lo, hi, label = (pmap or PROGRESS)[key]
    label = extra or label
    if progress is None:
        progress = lo
    session.execute(
        update(Job).where(Job.id == job_id).values(stage_key=key, stage_label=label, progress=int(progress))
    )
    session.commit()
    log_event(session, job_id, f"Этап: {label}")


# Импорт модели Job здесь, чтобы переиспользовать схему backend
from backend.app.models import Job  # noqa: E402


# ----------------------------------------------------------------
# Стадии
# ----------------------------------------------------------------

def download_source(session, ws: Workspace, job: Job) -> None:
    set_stage(session, job.id, "download")
    if job.source_type == "upload":
        ws.source  # файл уже на общем томе (положил backend)
        return
    url = job.source_url
    out = ws.root / "source.mp4"
    # -S8 ловит вертикальные/горизонтальные до 1080p; yt-dlp сам возьмёт лучший прогрессивный
    cmd = [
        "yt-dlp", "-f", "bv*[height<=1080]+ba/b[height<=1080]",
        "--merge-output-format", "mp4", "-o", str(out), "--no-playlist", url,
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp не смог скачать {url}: {proc.stderr[-600:]}")


def extract_audio(session, ws: Workspace) -> None:
    set_stage(session, ws.job_id, "audio")
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(ws.source), "-vn", "-ac", "1", "-ar", "16000", str(ws.audio)],
        capture_output=True, text=True, check=True,
    )


def transcribe(session, ws: Workspace, model: str) -> list[Segment]:
    """WhisperX (word-timestamps) при наличии → faster-whisper int8 (фолбэк)."""
    return _whisper_segments(session, ws, model)


def _whisper_segments(session, ws: Workspace, model: str, pmap: dict | None = None) -> list[Segment]:
    """Единая точка транскрипции: P2-адаптер stt.py + инкрементальный прогресс."""
    pmap = pmap or PROGRESS
    set_stage(session, ws.job_id, "transcribe", pmap=pmap)
    lo, hi, _ = pmap["transcribe"]
    if stt_mod.whisperx_available():
        rows, info = stt_mod.transcribe_audio(ws.audio, model)
        set_stage(session, ws.job_id, "transcribe", progress=hi, pmap=pmap)
        segments = [Segment(start=r["start"], end=r["end"], text=r["text"]) for r in rows]
        ws.transcript.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
        log_event(session, ws.job_id,
                  f"WhisperX: word-timestamps, модель {model}, сегментов {len(segments)}, язык {info.get('language')}")
        return segments
    try:
        from faster_whisper import WhisperModel
    except ImportError as e:
        raise RuntimeError("faster-whisper не установлен в образе воркера") from e

    loaded = WhisperModel(model, device="cpu", compute_type="int8", cpu_threads=4)
    segments_iter, info = loaded.transcribe(str(ws.audio), language=None, vad_filter=True, beam_size=5)
    segments: list[Segment] = []
    rows = []
    for seg in segments_iter:
        segments.append(Segment(start=seg.start, end=seg.end, text=seg.text.strip()))
        rows.append({"start": round(seg.start, 2), "end": round(seg.end, 2), "text": seg.text.strip()})
        if len(rows) % 10 == 0:  # прогресс внутри стадии
            frac = min(1.0, seg.end / max(1.0, info.duration))
            set_stage(session, ws.job_id, "transcribe", progress=lo + int(frac * (hi - lo)), pmap=pmap)
    ws.transcript.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
    log_event(session, ws.job_id, f"Whisper: модель {model}, сегментов {len(segments)}, язык {info.language}")
    return segments


# ----------------------------------------------------------------
# Shorts: нарезка + субтитры
# ----------------------------------------------------------------

def build_short_captions(segments: list[Segment], max_chars: int = 42,
                         max_total: float = 90.0) -> tuple[list[list[float]], list[list]]:
    """Динамичная нарезка под целевую длительность: склеиваем речь в реплики ≤ max_chars,
    выкидываем пустые паузы; edits — сквозные интервалы активных реплик.

    max_total — потолок итогового ролика в секундах (⚡60 / ⏱️90 / 🎬180 —
    пресет target_duration из Mini App; YouTube Shorts до 3 минут с 15.10.2024)."""
    edits: list[list[float]] = []
    captions: list[list] = []
    phrase_start: float | None = None
    phrase_text = ""

    for seg in segments:
        text = seg.text.strip()
        if not text:
            continue
        if phrase_start is None:
            phrase_start = seg.start
            phrase_text = text
        else:
            phrase_text += " " + text

        # Двуязычный/одноязычный формат субтитров определяет движок (ass_path);
        # здесь отдаём «как услышано» с таймкодами.
        if len(phrase_text) >= max_chars or seg.end - phrase_start >= 5.0:
            captions.append([round(phrase_start, 2), round(seg.end, 2), phrase_text.strip()])
            edits.append([round(phrase_start, 2), round(seg.end, 2)])
            phrase_start, phrase_text = None, ""

    if phrase_start is not None and segments:
        captions.append([round(phrase_start, 2), round(segments[-1].end, 2), phrase_text.strip()])
        edits.append([round(phrase_start, 2), round(segments[-1].end, 2)])

    # Ограничиваем итог до целевой длительности, берём начало (самое динамичное)
    total, cut_at = 0.0, len(edits)
    for i, (s, e) in enumerate(edits):
        total += e - s
        if total > max_total:
            cut_at = max(1, i + 1)
            break
    return edits[:cut_at], captions[:cut_at]


def render_short(session, ws: Workspace, params: ShortParams) -> None:
    set_stage(session, ws.job_id, "cut")
    segments = json.loads(ws.transcript.read_text(encoding="utf-8"))
    seg_objs = [Segment(**s) for s in segments]
    # 🎬 Целевая длительность готового ролика (⚡60 / ⏱️90 / 🎬180 сек) —
    # пресет выбирается в Mini App и синхронен с hook_scorer.DURATION_PRESETS
    _, max_total = hook_scorer.resolve_duration(getattr(params, "target_duration", None))
    edits, captions = build_short_captions(seg_objs, max_total=max_total)

    # P1: реальная вырезка пауз внутри реплик (silencedetect -38 dB / 450 мс)
    if params.remove_silence:
        silences = silence_cutter.detect_silences(ws.audio)
        tightened = silence_cutter.tighten_edits(edits, silences)
        if tightened != edits:
            captions = silence_cutter.remap_captions(captions, silences)
            saved = max(0.0, silence_cutter.cut_duration(edits) - silence_cutter.cut_duration(tightened))
            if saved >= 0.3:
                log_event(session, ws.job_id,
                          f"Silence Cutter: вырезано {saved:.1f} с пауз (>450 мс, -38 dB, pad 120 мс)")
                edits = tightened

    ws._short = params
    # Кадр обложки: ffmpeg достаёт кадр в позиции cover_frame из получившихся edits
    set_stage(session, ws.job_id, "cut", "Подбор нарезки и субтитров", 44)
    total = edits[-1][1] if edits else 60.0
    frame_at = max(0.5, total * params.cover_frame / 100)
    frame_path = ws.root / "thumb_base.png"
    subprocess.run(
        ["ffmpeg", "-y", "-ss", str(frame_at), "-i", str(ws.source), "-frames:v", "1", str(frame_path)],
        capture_output=True, text=True, check=True,
    )
    ws.thumbnail_frame = frame_path

    set_stage(session, ws.job_id, "render", f"Рендер сегментов {len(edits)}/{len(edits)}")
    log_event(session, ws.job_id, f"Кодирование: {hwaccel.hw_name()} (hwaccel.py; fallback libx264)")
    cfg = ws.write_short_config(edits, captions)
    ws.run_engine("render_short", cfg, timeout=3600)

    set_stage(session, ws.job_id, "cover")
    ws.run_engine("thumb_short", ws.write_thumb_short_config(), timeout=600)

    # P1–P3: SFX · музыка · дубляж — после рендера движка (видео не перекодируем)
    _apply_audio_enhancements(session, ws, params, edits)


# ----------------------------------------------------------------
# P1–P3: пост-обработка звука (SFX / музыка / дубляж) — после движка
# ----------------------------------------------------------------

def _apply_audio_enhancements(session, ws: Workspace, params: ShortParams, edits: list) -> None:
    """SFX-акценты, фоновая музыка с дакингом, RU⇄UA-дубляж.

    Каждый шаг — graceful: любая ошибка пишется warn-событием и НЕ валит
    задачу (ролик остаётся валидным, просто без этой улучшалки).
    Итоговый файл всегда занимает место final.mp4.
    """
    final = ws.final
    if params.sfx:
        try:
            plan = sfx_mod.sfx_plan(edits)
            if plan:
                final = sfx_mod.mix_sfx(final, plan, ws.root)
                log_event(session, ws.job_id,
                          f"SFX: {len(plan)} акцентов whoosh/impact (процедурные, CC0-эквивалент)")
        except Exception as e:  # noqa: BLE001
            log_event(session, ws.job_id, f"SFX: пропущено ({e})", level="warn")
    if params.music:
        try:
            final = music_duck.apply_music(final, Path(get_settings().music_dir), ws.root)
            log_event(session, ws.job_id, "Музыка: фоновая подложка, sidechain-дакинг под голос")
        except Exception as e:  # noqa: BLE001
            log_event(session, ws.job_id, f"Музыка: пропущена ({e})", level="warn")
    if params.dub:
        try:
            final = _apply_dub(session, ws, params)
        except dub_mod.DubUnavailable as e:
            log_event(session, ws.job_id, f"Дубляж: пропущен ({e})", level="warn")
        except Exception as e:  # noqa: BLE001
            log_event(session, ws.job_id, f"Дубляж: ошибка ({e})", level="warn")
    if final != ws.final and final.exists():
        final.replace(ws.final)  # итог занимает каноническое имя final.mp4


def _apply_dub(session, ws: Workspace, params: ShortParams):
    """P3: перевод реплик → edge-tts → оригинал приглушён фоном (-11 dB)."""
    import asyncio

    src_lang = (params.speech_lang or "uk").lower()
    if src_lang not in ("uk", "ru"):
        raise dub_mod.DubUnavailable(f"дубляж для языка {src_lang} не поддерживается")
    dst = "ru" if src_lang == "uk" else "uk"
    rows = json.loads(ws.transcript.read_text(encoding="utf-8"))
    lines = dub_mod.plan_dub(rows)
    if not lines:
        return ws.final
    s = get_settings()
    texts = dub_mod.translate_lines(
        [l["text"] for l in lines], src_lang, dst,
        s.llm_api_key, s.llm_base_url, s.llm_model,
    )
    voice = dub_mod.pick_voice(src_lang, dst)

    parts: list[Path] = []

    async def synth_all() -> None:
        for i, text in enumerate(texts):
            p = ws.root / f"dub_{i}.mp3"
            await dub_mod.synth_voice(text, voice, p)
            parts.append(p)

    asyncio.run(synth_all())
    dub_wav = dub_mod.join_phrases(parts, ws.root / "dub_track.wav")
    out = ws.root / "final_dub.mp4"
    subprocess.run(dub_mod.build_dub_mix_cmd(ws.final, dub_wav, out),
                   check=True, capture_output=True, text=True, timeout=900)
    log_event(session, ws.job_id,
              f"Дубляж: {len(texts)} реплик {src_lang}→{dst}, голос {voice}, оригинал фоном")
    return out


# ----------------------------------------------------------------
# Long: аудит пауз + сегментный рендер + главы
# ----------------------------------------------------------------

def render_long(session, ws: Workspace, params: LongParams, meta_title: str) -> None:
    ws._long = params
    set_stage(session, ws.job_id, "cut", "Аудит пауз (audit_gaps)")
    cfg = ws.write_long_config()
    ws.run_engine("audit_gaps", cfg, timeout=1800)

    clean = ws.root / "transcript_clean.json"
    n_segments = len(json.loads(clean.read_text(encoding="utf-8"))) if clean.exists() else 1

    set_stage(session, ws.job_id, "render", f"Рендер сегментов 1/{n_segments}")
    # Прогресс по файлам сегментов, которые пишет движок (NOTE: каталог segments/)
    import threading

    def watch():
        seen = 0
        while True:
            done = len(list((ws.root / "segments").glob("seg_*.mp4"))) if (ws.root / "segments").exists() else 0
            if done != seen and done:
                seen = done
                frac = 46 + int(42 * min(1.0, done / max(1, n_segments)))
                set_stage(session, ws.job_id, "render", f"Рендер сегментов {done}/{n_segments}", frac)
            if stop.is_set():
                return

    stop = threading.Event()
    watcher = threading.Thread(target=watch, daemon=True)
    watcher.start()
    try:
        ws.run_engine("render_segments", cfg, timeout=14400)
    finally:
        stop.set()

    set_stage(session, ws.job_id, "cover")
    if params.chapters:
        rows = json.loads(clean.read_text(encoding="utf-8")) if clean.exists() else []
        chapters = _build_chapters(rows)
        title = meta_title or "Судовое засідання / лекція — очищена версія"
        desc = "Паузы и технические ожидания удалены. Субтитры встроены.\n\n" + chapters
        ws.write_metadata(title, desc, ["суд", "Запоріжжя", "правалюдины"])
    # Горизонтальная обложка: кадр из середины
    frame_path = ws.root / "thumb_base.png"
    subprocess.run(
        ["ffmpeg", "-y", "-ss", "60", "-i", str(ws.final), "-frames:v", "1", str(frame_path)],
        capture_output=True, text=True, check=True,
    )


def _build_chapters(rows: list[dict], max_chapters: int = 12) -> str:
    def ts(sec: float) -> str:
        h, rem = divmod(int(sec), 3600)
        m, s = divmod(rem, 60)
        return f"{h:02d}:{m:02d}:{s:02d}" if h else f"{m:02d}:{s:02d}"

    lines = [f"{ts(r['start'])} {r['text'][:60].strip()}" for r in rows[:: max(1, len(rows) // max_chapters)][:max_chapters]]
    return "00:00 Початок\n" + "\n".join(lines)


# ----------------------------------------------------------------
# Завершение: регистр результата и защита памяти
# ----------------------------------------------------------------

def _tc(sec: float) -> str:
    sec = int(sec)
    return f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}" if sec >= 3600 else f"{sec // 60}:{sec % 60:02d}"


def _yt_meta_for_render(job_type: str, params: dict, source_name: str | None,
                        source_url: str | None) -> dict:
    """Полный YouTube-пакет для готового ролика: Название + Описание (с таймкодами
    источника и хэштегами) + Теги. Прикладывается ботом к видео в чат — владелец
    копирует и вставляет при публикации."""
    title_lines = [p for p in (params.get("title_line1"), params.get("title_line2")) if p]
    base = " ".join(title_lines) or source_name or "Рішення суду"
    if job_type == "hook_render":
        title = f"{base[:95]} #shorts"
        start, end = float(params.get("start_sec", 0)), float(params.get("end_sec", 0))
        description = (
            f"{base}\n\n"
            f"Фрагмент из источника: {source_url or '—'}\n"
            f"Таймкод: {_tc(start)}–{_tc(end)}\n\n"
            "Подписывайтесь — разбираем судебную практику простыми словами.\n"
            "#shorts #суд #права #юридическая_просвіта #КСУ #прецедент"
        )
        tags = ["shorts", "суд", "права людини", "юридична просвіта", "прецедент",
                "Верховний Суд", "КСУ", "твої права"]
    elif job_type == "long":
        title = f"{base[:95]} — повна версія без пауз"
        description = (
            f"{base}\n\n"
            f"Источник: {source_url or '—'}\n"
            "Паузы и технические ожидания удалены (Whisper audit_gaps). Главы — в описании плеера.\n"
            "#суд #засідання #право #КСУ #повна_версія"
        )
        tags = ["суд", "засідання", "право", "КСУ", "повна версія", "судова практика"]
    else:  # classic short
        title = f"{base[:95]} #shorts"
        description = (
            f"{base}\n\n"
            f"Источник: {source_url or '—'}\n"
            "Подписывайтесь — судебная практика простыми словами.\n"
            "#shorts #суд #права #КСУ #прецедент"
        )
        tags = ["shorts", "суд", "права людини", "КСУ", "прецедент", "твої права"]
    return {"title": title, "description": description, "tags": tags}


def finalize(session, ws: Workspace, job: Job) -> None:
    import datetime as _dt

    set_stage(session, job.id, "deliver", "Упаковка результата", 97)
    if not ws.final.exists():
        raise RuntimeError("final.mp4 не создан — проверьте логи движка")
    thumb_url = f"/api/jobs/{job.id}/thumb"
    yt_meta = _yt_meta_for_render(job.type, parse_params(job.params), job.source_name, job.source_url)
    base_params = parse_params(job.params)
    base_params["youtube_meta"] = yt_meta
    session.execute(
        update(Job).where(Job.id == job.id).values(
            status="completed",
            stage_key="done",
            stage_label=PROGRESS["done"][2],
            progress=100,
            result_url=f"/api/jobs/{job.id}/result",
            thumb_url=thumb_url,
            params=json.dumps(base_params, ensure_ascii=False),
            completed_at=_dt.datetime.now(_dt.timezone.utc),
        )
    )
    session.commit()
    log_event(session, job.id, "Движок: loudnorm применён, final.mp4 собран, задача завершена (YouTube-пакет приложен)")


def _complete(session, job: Job, stage_label: str, result_url: str | None = None,
              extra_params: dict | None = None) -> None:
    """Завершение новых конвейеров (hook_analysis — без final.mp4; news_shorts — до модерации)."""
    import datetime as _dt
    import json as _json

    values = {
        "status": "completed", "stage_key": "done", "stage_label": stage_label,
        "progress": 100, "result_url": result_url,
        "completed_at": _dt.datetime.now(_dt.timezone.utc),
    }
    if extra_params is not None:
        base = parse_params(job.params)
        base.update(extra_params)
        values["params"] = _json.dumps(base, ensure_ascii=False)
    session.execute(update(Job).where(Job.id == job.id).values(**values))
    session.commit()


# ----------------------------------------------------------------
# Фича №1: AI Hook Finder (анализ) — YouTube → кандидаты Shorts
# ----------------------------------------------------------------

def run_hook_analysis(session, job: Job) -> None:
    """Ссылка → только аудио (быстро) → Whisper с таймкодами → Hook Scoring → меню."""
    from backend.app.models import HookCandidate, new_id

    from . import hook_scorer
    from .config import get_settings

    s = get_settings()
    ws = Workspace.for_job(job.id)
    log_event(session, job.id, "Hook Finder: анализ вирусных фрагментов запущен")

    # 🎬 Целевая длительность готовых Shorts из params (⚡60 / ⏱️90 / 🎬180 сек) —
    # выбирается в Mini App; по умолчанию классические 35–60 с
    job_params = parse_params(job.params)
    target_duration = job_params.get("target_duration")
    min_dur, max_dur = hook_scorer.resolve_duration(target_duration)
    if target_duration:
        log_event(session, job.id,
                  f"Hook Finder: целевая длительность {target_duration} "
                  f"({min_dur:.0f}–{max_dur:.0f} с)")

    # 0. P0: мультиплатформенность — yt-dlp умеет 1000+ сайтов (YouTube, TikTok,
    #    Instagram, VK, RuTube…), отдельная логика не нужна; аудио качаем как раньше

    # 1. Только аудиодорожка — на 20–60 мин это в 5–10 раз быстрее полного видео
    set_stage(session, job.id, "fetch", pmap=HOOK_ANALYSIS_PROGRESS)
    audio_src = ws.root / "source_audio.m4a"
    cmd = [
        "yt-dlp", "-f", "bestaudio[ext=m4a]/bestaudio", "--no-playlist",
        "-o", str(audio_src), job.source_url or "",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp не смог скачать аудио {job.source_url}: {proc.stderr[-500:]}")

    ws.audio.unlink(missing_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(audio_src), "-vn", "-ac", "1", "-ar", "16000", str(ws.audio)],
        capture_output=True, text=True, check=True,
    )

    # 2. Whisper: фразы с точными таймкодами
    segments = transcribe_map(session, ws, s.whisper_model_short, HOOK_ANALYSIS_PROGRESS)

    # 3. AI Hook Scoring (пресет длительности перекрывает настройки по умолчанию)
    set_stage(session, job.id, "analyze", pmap=HOOK_ANALYSIS_PROGRESS)
    candidates = hook_scorer.find_hooks(
        [{"start": x.start, "end": x.end, "text": x.text} for x in segments],
        min_dur=min_dur, max_dur=max_dur, top=s.hook_max_candidates,
        target_duration=str(target_duration) if target_duration else None,
    )
    if not candidates:
        raise RuntimeError(
            f"В видео не найдено ни одного связного фрагмента {min_dur:.0f}–{max_dur:.0f} с "
            "— попробуйте другое видео или другую длительность"
        )
    candidates = hook_scorer.llm_refine(candidates)

    # 3.5 P0/P1: превью-кадры 9:16 + 10-сек ролики для карточек (Opus Clip UX)
    previews = _make_hook_previews(session, job, candidates, ws)

    # 4. Сохраняем: таблица HookCandidate (канон) + params.candidates (портабельно для pull-воркера)
    params = job_params
    portable = []
    for c in candidates:
        pv = previews.get(c.rank) or {}
        session.add(HookCandidate(
            id=new_id(), job_id=job.id, rank=c.rank,
            start_sec=c.start, end_sec=c.end, duration_sec=c.duration,
            title=c.title, quote=c.quote, score=c.score,
            breakdown=json.dumps(c.breakdown, ensure_ascii=False),
            title_variants=json.dumps(c.title_variants, ensure_ascii=False),
            thumb_url=pv.get("thumb_url"), preview_url=pv.get("preview_url"),
        ))
        portable.append({**c.to_dict(), **pv})
    session.commit()

    params["candidates"] = portable
    params["analysis_done"] = True
    _complete(session, job, HOOK_ANALYSIS_PROGRESS["done"][2], result_url=None,
              extra_params=params)
    log_event(session, job.id, f"Hook Finder: отобрано {len(candidates)} кандидатов "
                               f"(scores: {[c.score for c in candidates]})")


def _make_hook_previews(session, job: Job, candidates, ws: Workspace) -> dict:
    """P0/P1: кадр 9:16 + 10-сек ролик на каждого кандидата — «как в Opus Clip».

    Качаем только 480p-фрагмент (yt-dlp --download-sections) — секунды вместо
    минут; кадр достаём ffmpeg, ролик кодируем через VAAPI при наличии.
    Ошибка одного кандидата не валит анализ — карточка будет без превью.
    """
    from .config import get_settings

    if get_settings().dry_run:
        log_event(session, job.id, "Превью: dry-run — кадры и ролики пропущены")
        return {}
    out: dict = {}
    for c in candidates:
        try:
            sec_file = ws.root / f"hook_src_{c.rank}.mp4"
            cmd = [
                "yt-dlp", "-f", "bv*[height<=480]+ba/b[height<=480]",
                "--merge-output-format", "mp4",
                "--download-sections", f"*{c.start:.2f}-{min(c.end, c.start + 10.5):.2f}",
                "--force-keyframes-at-cuts", "--no-playlist",
                "-o", str(sec_file), job.source_url or "",
            ]
            proc = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
            if proc.returncode != 0 or not sec_file.exists():
                continue
            thumb = ws.root / f"hook_thumb_{c.rank}.jpg"
            subprocess.run(
                ["ffmpeg", "-y", "-ss", "1.0", "-i", str(sec_file),
                 "-frames:v", "1", "-q:v", "3", str(thumb)],
                capture_output=True, text=True, check=True, timeout=60,
            )
            preview = ws.root / f"hook_preview_{c.rank}.mp4"
            height = get_settings().preview_height
            cmd2 = [
                "ffmpeg", "-y", *hwaccel.input_hw_args(), "-i", str(sec_file),
                "-t", "10", "-vf", hwaccel.scale_filter(height), "-an",
                *hwaccel.encoder_args(23), "-movflags", "+faststart", str(preview),
            ]
            subprocess.run(cmd2, capture_output=True, text=True, check=True, timeout=180)
            sec_file.unlink(missing_ok=True)
            out[c.rank] = {
                "thumb_url": f"/api/jobs/{job.id}/candidates/{c.rank}/thumb",
                "preview_url": f"/api/jobs/{job.id}/candidates/{c.rank}/preview",
            }
        except Exception as e:  # noqa: BLE001 — превью опционально
            log_event(session, job.id, f"Превью #{c.rank}: пропущено ({e})", level="warn")
    if out:
        log_event(session, job.id,
                  f"Превью: кадры 9:16 + 10-сек ролики готовы для {len(out)}/{len(candidates)} "
                  f"фрагментов (кодирование: {hwaccel.hw_name()})")
    return out


def transcribe_map(session, ws: Workspace, model: str, pmap: dict) -> list:
    """Как transcribe(), но с прогресс-картой нового конвейера (и возвратом сегментов)."""
    return _whisper_segments(session, ws, model, pmap=pmap)


# ----------------------------------------------------------------
# Фича №1: рендер выбранного фрагмента — фирменный Short движка
# ----------------------------------------------------------------

def run_hook_render(session, job: Job) -> None:
    """Выбранный кандидат → фирменный вертикальный 1080×1920 (движок, EBU R128)."""
    params = parse_params(job.params)
    start, end = float(params.get("start_sec", 0)), float(params.get("end_sec", 0))
    analysis_id = params.get("analysis_job_id", "")
    if end <= start:
        raise RuntimeError("Некорректный фрагмент (start/end)")

    ws = Workspace.for_job(job.id)
    set_stage(session, job.id, "fetch", pmap=HOOK_RENDER_PROGRESS)

    # 1. Скачиваем ТОЛЬКО фрагмент (yt-dlp --download-sections — экономия десятков минут)
    out = ws.root / "source.mp4"
    cmd = [
        "yt-dlp", "-f", "bv*[height<=1080]+ba/b[height<=1080]", "--merge-output-format", "mp4",
        "--download-sections", f"*{max(0.0, start - 0.5):.2f}-{end + 0.5:.2f}",
        "--force-keyframes-at-cuts", "--no-playlist", "-o", str(out), job.source_url or "",
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"yt-dlp не смог скачать фрагмент: {proc.stderr[-500:]}")

    # 2. Субтитры из транскрипции анализа (сдвигаем таймкоды фрагмента к нулю)
    set_stage(session, job.id, "cut", pmap=HOOK_RENDER_PROGRESS)
    segments: list[Segment] = []
    if analysis_id:
        src = Workspace.for_job(analysis_id).transcript
        if src.exists():
            for row in json.loads(src.read_text(encoding="utf-8")):
                if row["end"] > start - 0.3 and row["start"] < end + 0.3:
                    segments.append(Segment(
                        start=max(0.0, row["start"] - start),
                        end=min(end - start, row["end"] - start),
                        text=row["text"],
                    ))
    if not segments:  # транскрипция потеряна — рендерим без субтитров
        log_event(session, job.id, "Транскрипция анализа недоступна — рендер без субтитров", level="warn")

    duration = end - start
    edits = [[0.0, duration]]
    captions = [[round(s.start, 2), round(s.end, 2), s.text] for s in segments]

    # P1: вырезаем паузы внутри выбранного фрагмента (по умолчанию включено).
    # Фрагмент скачан с запасом 0.5 c (--download-sections): сдвигаем ось тишины
    # к нуля edits (t=0 ≈ оригинальный start).
    if params.get("remove_silence", True):
        try:
            delta = min(0.5, max(0.0, start))
            raw_silences = silence_cutter.detect_silences(ws.source)
            silences = [(max(0.0, ss - delta), max(0.0, se - delta))
                        for ss, se in raw_silences if se - ss > 0.2]
            tightened = silence_cutter.tighten_edits(edits, silences)
            if tightened != edits:
                captions = silence_cutter.remap_captions(captions, silences)
                saved = max(0.0, silence_cutter.cut_duration(edits) - silence_cutter.cut_duration(tightened))
                if saved >= 0.3:
                    log_event(session, job.id,
                              f"Silence Cutter: из фрагмента вырезано {saved:.1f} с пауз (>450 мс, -38 dB)")
                    edits = tightened
        except Exception as e:  # noqa: BLE001 — вырезка не должна валить монтаж
            log_event(session, job.id, f"Silence Cutter: пропущен ({e})", level="warn")

    sp = ShortParams(
        title_line1=params.get("title_line1", ""),
        title_line2=params.get("title_line2", ""),
        overlay_label=params.get("overlay_label", "КСУ"),
        pill_text=params.get("pill_text", ""),
        speech_lang=params.get("speech_lang", "uk"),
        subtitle_lang=params.get("subtitle_lang", "uk"),
        bilingual=bool(params.get("bilingual", False)),
        cover_frame=int(params.get("cover_frame", 35)),
        remove_silence=bool(params.get("remove_silence", True)),
        sfx=bool(params.get("sfx", False)),
        music=bool(params.get("music", False)),
        dub=bool(params.get("dub", False)),
    )
    ws._short = sp
    frame_at = max(0.5, duration * sp.cover_frame / 100)
    frame_path = ws.root / "thumb_base.png"
    subprocess.run(
        ["ffmpeg", "-y", "-ss", str(frame_at), "-i", str(ws.source), "-frames:v", "1", str(frame_path)],
        capture_output=True, text=True, check=True,
    )
    ws.thumbnail_frame = frame_path

    set_stage(session, job.id, "render", pmap=HOOK_RENDER_PROGRESS)
    cfg = ws.write_short_config(edits, captions)
    ws.run_engine("render_short", cfg, timeout=3600)
    set_stage(session, job.id, "cover", pmap=HOOK_RENDER_PROGRESS)
    ws.run_engine("thumb_short", ws.write_thumb_short_config(), timeout=600)

    set_stage(session, job.id, "deliver", pmap=HOOK_RENDER_PROGRESS)
    if not ws.final.exists():
        raise RuntimeError("final.mp4 не создан движком")
    _complete(session, job, HOOK_RENDER_PROGRESS["done"][2],
              result_url=f"/api/jobs/{job.id}/result",
              extra_params={"youtube_meta": _yt_meta_for_render("hook_render", params, job.source_name, job.source_url)})
    _cleanup_analysis_if_done(session, job)
    log_event(session, job.id, f"Hook Render: фрагмент {start:.0f}–{end:.0f} c смонтирован (YouTube-пакет приложен)")


def _cleanup_analysis_if_done(session, job: Job) -> None:
    """После последнего hook_render по анализу чистим его рабочую папку (диск!)."""
    import json as _json
    import shutil

    from backend.app.models import Job as _Job

    params = parse_params(job.params)
    analysis_id = params.get("analysis_job_id", "")
    if not analysis_id:
        return
    busy = 0
    for other in session.scalars(select(_Job).where(_Job.type == "hook_render")).all():
        if other.id == job.id or other.status in ("queued", "processing"):
            op = parse_params(other.params)
            if op.get("analysis_job_id") == analysis_id:
                busy += 1
    if busy == 0:
        ws_dir = Workspace.for_job(analysis_id).root
        shutil.rmtree(ws_dir, ignore_errors=True)
        log_event(session, job.id, f"Cleanup: рабочая папка анализа {analysis_id[:8]} удалена")


# ----------------------------------------------------------------
# Фича №2: news_shorts — domdara → сценарий → озвучка → вертикальный ролик
# ----------------------------------------------------------------

def run_news_shorts(session, job: Job) -> None:
    """Статья судебной практики → 45-секундный ролик → модерация владельца."""
    from backend.app.models import NewsArticle

    from . import tts_narrator
    from .config import get_settings

    s = get_settings()
    params = parse_params(job.params)
    ws = Workspace.for_job(job.id)

    def report(stage_label: str, percent: int) -> None:
        session.execute(update(Job).where(Job.id == job.id).values(
            stage_label=stage_label, progress=int(percent)))
        session.commit()

    article_text = params.get("article_text", "")
    article_title = params.get("article_title") or job.source_name or "Рішення суду"
    variant = int(params.get("variant", 0))

    meta = tts_narrator.render_news_short(
        ws.root, article_title, article_text, variant=variant,
        voice=params.get("voice", ""), alt_voice="",   # пусто → авто-подбор по языку статьи
        progress=report,
    )
    yt_meta = tts_narrator.youtube_metadata(article_title, meta["script"], params.get("article_url", job.source_url or ""))

    # Модерация: Human-in-the-Loop — публикация только после одобрения
    _complete(session, job, NEWS_PROGRESS["done"][2],
              result_url=f"/api/jobs/{job.id}/result",
              extra_params={
                  "youtube_meta": yt_meta, "hook": meta["script"]["hook"],
                  "fabula": meta["script"]["fabula"], "conclusion": meta["script"]["conclusion"],
                  "duration_sec": meta["duration_sec"], "voice": meta["voice"],
                  "subtitle_style": meta["subtitle_style"],
              })
    session.execute(update(Job).where(Job.id == job.id).values(approval_status="pending"))
    article = session.query(NewsArticle).filter(NewsArticle.id == params.get("article_id", "")).first()
    if article:
        article.state = "rendered"
        session.commit()
    log_event(session, job.id, f"News Short готов ({meta['duration_sec']} c, {meta['words']} слов) — ожидает модерации")
