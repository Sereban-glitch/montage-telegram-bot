"""Фича №2, слой трансформации: статья domdara.org → 45-секундный вертикальный Short.

Конвейер (всё бесплатно, офлайн-совместимо с ноутбуком-воркером):
  1. build_script()      — юридический текст постановления → динамичный сценарий
                           (кликбейтный хук / фабула простыми словами / вывод для граждан),
                           ~100 слов ≈ 45 c озвучки; variant=1/2 даёт альтернативную подачу
                           для кнопки «Перегенерировать».
  2. synthesize()        — edge-tts (uk-UA-OstapNeural, фолбэк PolinaNeural) + WordBoundary
                           события → точные тайминги КАЖДОГО слова.
  3. loudnorm EBU R128   — I=-14 LUFS, TP=-1.5 dBTP, LRA=11 (тот же стандарт, что и в
                           основном движке).
  4. words_to_ass()      — караоке-субтитры ASS: DejaVu Sans Bold на подложке,
                           активное слово заливается золотым (killer-фича КФ-1).
  5. build_background()  — процедурный вертикальный фон 1080×1920 (gradients + золотая
                           рамка + знак параграфа + верхний титул статьи).
  6. render_news_short() — сборка final.mp4 (H.264/AAC, -shortest) + миниатюра.

Модуль независим от SQLAlchemy: прогресс отдаётся через callback(stage, percent).
"""
from __future__ import annotations

import asyncio
import json
import re
import subprocess
import time
from pathlib import Path

# ----------------------------------------------------------------
# Сценарий: юридический язык → простой украинский
# ----------------------------------------------------------------

_SIMPLIFY = (
    ("постановив", "вирішив"),
    ("постанова суду", "рішення суду"),
    ("особа", "людина"),
    ("особи", "людини"),
    ("позивач", "той, хто скаржився"),
    ("відповідач", "друга сторона"),
    ("визнав обґрунтованим", "підтвердив"),
    ("позов задовольнити", "позов задоволено — людина виграла"),
    ("у задоволенні позову відмовити", "у позові відмовили"),
    ("скасувати рішення", "скасувати рішення нижчого суду"),
    ("стягнути", "примусили виплатити"),
    ("відшкодування моральної шкоди", "компенсацію за моральні страждання"),
    ("безпідставно", "без законних підстав"),
    (" відповідно до закону", " за законом"),
    ("виходячи з", "суд врахував"),
    ("зазначив", "сказав"),
    ("доводи", "аргументи"),
)

_HOOK_TEMPLATES_UK = {
    0: "Рішення суду, яке варте вашої уваги. {essence}",
    1: "Верховний Суд сказав: так. {essence}",
    2: "Цей судовий прецедент захистить мільйони українців. {essence}",
}
_HOOK_TEMPLATES_RU = {
    0: "Решение суда, которое стоит вашего внимания. {essence}",
    1: "Верховный Суд сказал: да. {essence}",
    2: "Этот судебный прецедент защитит миллионы украинцев. {essence}",
}
_CONCLUSION_UK = (
    "Запам’ятайте головне: {rule}. Це прецедент — посилайтеся на нього, "
    "коли захищаєте свої права. Підписуйтесь — розбираємо судові рішення простими словами."
)
_CONCLUSION_RU = (
    "Запомните главное: {rule}. Это прецедент — ссылайтесь на него, "
    "когда защищаете свои права. Подписывайтесь — разбираем судебные решения простыми словами."
)

_SENT_RE = re.compile(r"(?<=[.!?…])\s+")
_WORD_RE = re.compile(r"[А-Яа-яЄєІіЇїҐґA-Za-z’']+")

_UK_LETTERS = "ііїєґ'’"          # украинские эксклюзивные буквы/апостроф
_RU_LETTERS = "ыэъё"             # русские эксклюзивные буквы


def detect_lang(text: str) -> str:
    """uk | ru по эксклюзивным буквам. Статьи domdara.org бывают на обоих языках."""
    low = (text or "").lower()
    uk = sum(low.count(c) for c in _UK_LETTERS)
    ru = sum(low.count(c) for c in _RU_LETTERS)
    return "uk" if uk >= ru else "ru"


def _sentences(text: str) -> list[str]:
    return [s.strip() for s in _SENT_RE.split(text or "") if len(s.strip()) > 25]


def _simplify(text: str) -> str:
    for legal, plain in _SIMPLIFY:
        text = text.replace(legal, plain).replace(legal.capitalize(), plain.capitalize())
    return text


def _keyword_score(sent: str) -> float:
    low = sent.lower()
    keys = ("суд", "право", "грош", "компенсац", "штраф", "борг", "позов", "скасув",
            "стягн", "обов’язк", "обов'язк", "має ", "зобов’язан", "заборон", "порушен")
    return sum(2.0 for k in keys if k in low) + min(2.0, len(sent) / 160.0)


def _shorten(sent: str, max_len: int = 150) -> str:
    sent = re.sub(r"\s+", " ", sent).strip()
    if len(sent) <= max_len:
        return sent.rstrip(".!?…")
    cut = sent[:max_len].rsplit(" ", 1)[0]
    return cut.rstrip(",;:") + "…"


def build_script(article_title: str, article_text: str, variant: int = 0) -> dict:
    """Статья → сценарий 45 c. Возвращает {hook, fabula, conclusion, full, words, lang}.

    variant=0/1/2 — три подачи одного текста (кнопка «Перегенерировать»).
    Язык сценария следует языку статьи (uk/ru): domdara.org публикует оба.
    Для озвучки подбирается родной голос соответствующего языка — иначе
    нейроголос искажает фонетику. Полный перевод на украинский доступен
    через LLM-путь (см. отчёт, опциональный MONTAGE_LLM_API_KEY).
    """
    lang = detect_lang(f"{article_title} {article_text}")
    sents = _sentences(article_text)
    if not sents:
        raise RuntimeError("В статье не найдено содержательных предложений")
    scored = sorted(sents, key=_keyword_score, reverse=True)
    top = scored[:4] if len(scored) >= 4 else sents[:4]

    essence = _simplify(_shorten(top[0], 110))
    hooks = _HOOK_TEMPLATES_UK if lang == "uk" else _HOOK_TEMPLATES_RU
    conclusion_tpl = _CONCLUSION_UK if lang == "uk" else _CONCLUSION_RU
    fabula_lead = "Суть справи проста." if lang == "uk" else "Суть дела проста."

    hook = hooks[variant % len(hooks)].format(essence=essence)

    fabula_sents = [_simplify(_shorten(s, 165)) for s in (top[1:3] if len(top) >= 3 else top[:2])]
    fabula = fabula_lead + " " + " ".join(fabula_sents)

    # правило-вывод: предложение с максимальной модальностью из хвоста статьи
    tail = sents[-4:] if len(sents) >= 4 else sents
    rule_sent = max(tail, key=_keyword_score)
    rule = _simplify(_shorten(rule_sent, 120))
    conclusion = conclusion_tpl.format(rule=rule)

    full = f"{hook} {fabula} {conclusion}"
    words = _WORD_RE.findall(full)
    return {
        "hook": hook, "fabula": fabula, "conclusion": conclusion, "full": full,
        "words": len(words), "lang": lang,
        "est_seconds": round(len(words) / 2.25, 1),  # ~2.25 слова/с у edge-tts
    }


# ----------------------------------------------------------------
# edge-tts озвучка + тайминги слов
# ----------------------------------------------------------------

def synthesize(text: str, out_mp3: Path, voice: str = "uk-UA-OstapNeural",
               alt_voice: str = "uk-UA-PolinaNeural") -> list[dict]:
    """Озвучка текста edge-tts; возвращает тайминги слов [{word,start,dur}].

    Падение основного голоса (сеть/голос недоступен) → фолбэк на alt_voice,
    затем RuntimeError с инструкцией. Требует интернет (прод-ноутбук его имеет).
    """
    try:
        import edge_tts
    except ImportError as e:  # pragma: no cover
        raise RuntimeError("edge-tts не установлен (pip install edge-tts)") from e

    async def _run(v: str) -> tuple[bytes, list[dict]]:
        com = edge_tts.Communicate(text, v, rate="-4%")
        audio = bytearray()
        words: list[dict] = []
        async for chunk in com.stream():
            if chunk["type"] == "audio":
                audio.extend(chunk["data"])
            elif chunk["type"] == "WordBoundary":
                words.append({
                    "word": chunk["text"],
                    "start": chunk["offset"] / 1e7,       # 100-наносекундные тики → сек
                    "dur": chunk["duration"] / 1e7,
                })
        return bytes(audio), words

    last_err: Exception | None = None
    attempts = [voice, alt_voice, voice]  # третий заход основным голосом: сбой Microsoft часто разовый
    for i, v in enumerate(attempts):
        try:
            # Жёсткий таймаут на всю стрим-сессию: сеть к Microsoft может stalls'ить
            # посреди потока — воркер не имеет права зависнуть навсегда
            audio, words = asyncio.run(asyncio.wait_for(_run(v), timeout=120))
            if not audio:
                raise RuntimeError(f"голос {v}: пустой аудиопоток")
            out_mp3.write_bytes(audio)
            if not words:  # WordBoundary не пришёл — деградация на равномерные тайминги
                words = _even_word_timing(text)
            return words
        except Exception as e:  # noqa: BLE001 — NoAudioReceived/Timeout/сеть → повторяем
            last_err = e
            time.sleep(2 + i)  # линейный бэкофф между попытками
    raise RuntimeError(
        f"edge-tts недоступен ({last_err}). Проверьте сеть/голоса {voice}/{alt_voice} "
        "(pip install edge-tts; голоса uk-UA-OstapNeural / uk-UA-PolinaNeural)"
    )


def _even_word_timing(text: str) -> list[dict]:
    """Запасной путь: равномерная раскладка слов ~2.3 слова/с (если WordBoundary потерян)."""
    words = _WORD_RE.findall(text)
    wps = 2.3
    return [{"word": w, "start": i / wps, "dur": 1 / wps / max(1, len(w)) * 2.4} for i, w in enumerate(words)]


# ----------------------------------------------------------------
# Нормализация EBU R128
# ----------------------------------------------------------------

def loudnorm(src: Path, dst: Path) -> float:
    """Two-stage-friendly однократный loudnorm (динамический) → WAV 48k stereo.

    Возвращает длительность итогового аудио (сек) через ffprobe.
    """
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(src), "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
         "-ar", "48000", "-ac", "2", str(dst)],
        capture_output=True, text=True, check=True,
    )
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(dst)],
        capture_output=True, text=True, check=True,
    )
    return float(probe.stdout.strip())


# ----------------------------------------------------------------
# Караоке-субтитры ASS (killer-фича КФ-1: активное слово подсвечено)
# ----------------------------------------------------------------

ASS_HEADER = """[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV
Style: News,DejaVu Sans,62,&H00FFFFFF,&H0000D7FF,&H64000000,&H64000000,-1,0,0,0,100,100,0,0,3,10,0,2,70,70,330

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def _ass_time(sec: float) -> str:
    sec = max(0.0, sec)
    h = int(sec // 3600)
    m = int((sec % 3600) // 60)
    s = sec % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def _wrap_lines(words: list[dict], max_chars: int = 30) -> list[list[dict]]:
    """Слова → строки субтитров ≤ max_chars, разрыв по знакам препинания."""
    lines: list[list[dict]] = []
    cur: list[dict] = []
    for w in words:
        cand = " ".join([x["word"] for x in cur] + [w["word"]])
        if cur and (len(cand) > max_chars or (cur and cur[-1]["word"].endswith((".", "!", "?", "…")))):
            lines.append(cur)
            cur = [w]
        else:
            cur.append(w)
    if cur:
        lines.append(cur)
    return lines


def words_to_ass(words: list[dict], path: Path, duration: float, title: str = "") -> None:
    r"""Караоке-ASS: {\k<cs>} на каждое слово. SecondaryColour = золото (не спето),
    PrimaryColour = белый (спето) — классический karaoke-fill.
    Титул НЕ добавляем: он запечён в background.png (build_background).
    Подложка — BorderStyle=3 (полупрозрачная чёрная плашка)."""
    lines: list[str] = []
    for ln in _wrap_lines(words):
        start = ln[0]["start"]
        end = ln[-1]["start"] + ln[-1]["dur"] + 0.35
        text = " ".join(f"{{\\k{int(round(w['dur'] * 100))}}}{w['word']}" for w in ln)
        lines.append(f"Dialogue: 0,{_ass_time(start)},{_ass_time(min(end, duration))},News,,0,0,0,,{text}")
    path.write_text(ASS_HEADER + "\n".join(lines) + "\n", encoding="utf-8")


# ----------------------------------------------------------------
# Процедурный фон 1080×1920 (герб-стиль: параграф + золотая рамка + титул)
# ----------------------------------------------------------------

_FONT_CANDIDATES = (
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf",
)


def _font() -> str:
    for p in _FONT_CANDIDATES:
        if Path(p).exists():
            return p
    out = subprocess.run(["fc-match", "-f", "%{file}", "sans:bold"], capture_output=True, text=True)
    return out.stdout.strip() or "DejaVuSans"


def _drawtext_escape(s: str) -> str:
    return s.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\u2019").replace("%", "\\%")


def _wrap_title(title: str, max_chars: int = 24, max_lines: int = 3) -> list[str]:
    words = (title or "").upper().split()
    lines: list[str] = []
    cur = ""
    for w in words:
        cand = (cur + " " + w).strip()
        if len(cand) > max_chars and cur:
            lines.append(cur)
            cur = w
        else:
            cur = cand
        if len(lines) == max_lines:
            break
    if cur and len(lines) < max_lines:
        lines.append(cur)
    return lines[:max_lines]


def build_background(title: str, out_png: Path) -> None:
    """Вертикальный стилизованный фон: тёмно-синий градиент, золотая рамка, §, титул."""
    font = _font()
    t_lines = _wrap_title(title)
    if not t_lines:
        t_lines = ["СУДОВА ПРАКТИКА"]
    filters = [
        "gradients=s=1080x1920:c0=0x0A1830:c1=0x173B6B:x0=540:y0=120:x1=540:y1=1800:d=1",
        "drawbox=x=54:y=54:w=972:h=1812:color=0x37AFD4@0.9:t=7",   # золото BGR D4AF37
        "drawbox=x=78:y=78:w=924:h=1764:color=0x37AFD4@0.45:t=2",
        f"drawtext=fontfile={font}:text='§':fontsize=430:fontcolor=0x37AFD4@0.20:x=(w-text_w)/2:y=620",
        f"drawtext=fontfile={font}:text='{_drawtext_escape(chr(10).join(t_lines))}'"
        f":fontsize=58:fontcolor=0xE8F1FF:line_spacing=16:x=(w-text_w)/2:y=210:borderw=3:bordercolor=0x141414",
        f"drawtext=fontfile={font}:text='{_drawtext_escape('ДОМ ПРАВА · DOMDARA.ORG')}'"
        f":fontsize=34:fontcolor=0x37AFD4@0.95:x=(w-text_w)/2:y=1770",
    ]
    subprocess.run(
        ["ffmpeg", "-y", "-f", "lavfi", "-i", ",".join(filters), "-frames:v", "1", str(out_png)],
        capture_output=True, text=True, check=True,
    )


# ----------------------------------------------------------------
# Полная сборка news-Short
# ----------------------------------------------------------------

def render_news_short(
    workdir: Path,
    article_title: str,
    article_text: str,
    variant: int = 0,
    voice: str = "",
    alt_voice: str = "",
    progress=None,
) -> dict:
    """Статья → final.mp4 1080×1920 + thumbnail.jpg. Возвращает метаданные для модерации.

    progress: callable(stage: str, percent: int) — стадия для БД/динамического острова.
    Голос подбирается по языку статьи: uk → Ostap/Polina, ru → Dmitry/Svetlana
    (нейроголос не искажает фонетику чужого языка; LLM-перевод — отдельный путь).
    """
    from .config import get_settings

    s = get_settings()
    lang = detect_lang(f"{article_title} {article_text}")
    voice = voice or (s.news_voice if lang == "uk" else s.news_voice_ru)
    alt_voice = alt_voice or (s.news_voice_alt if lang == "uk" else s.news_voice_ru_alt)

    workdir.mkdir(parents=True, exist_ok=True)
    report = progress or (lambda stage, pct: None)

    report("Сценарий 45 секунд (хук → фабула → вывод)", 8)
    script = build_script(article_title, article_text, variant=variant)
    (workdir / "script.json").write_text(json.dumps(script, ensure_ascii=False, indent=2), encoding="utf-8")

    report("Озвучка edge-tts (украинский голос)", 20)
    narration = workdir / "narration.mp3"
    words = synthesize(script["full"], narration, voice=voice, alt_voice=alt_voice)
    (workdir / "words.json").write_text(json.dumps(words, ensure_ascii=False, indent=2), encoding="utf-8")

    report("Нормализация звука EBU R128 (-14 LUFS)", 38)
    norm = workdir / "narration_norm.wav"
    duration = loudnorm(narration, norm)

    report("Караоке-субтитры (подсветка активного слова)", 48)
    subs = workdir / "subtitles.ass"
    words_to_ass(words, subs, duration, title=article_title)

    report("Видеоряд 1080×1920 (фон + титул)", 60)
    bg = workdir / "background.png"
    build_background(article_title, bg)

    report("Рендер H.264 вертикального ролика", 74)
    final = workdir / "final.mp4"
    fonts_dir = str(Path(_font()).parent)
    vf = f"subtitles={subs.name}:fontsdir='{fonts_dir}',format=yuv420p"
    subprocess.run(
        ["ffmpeg", "-y", "-loop", "1", "-i", str(bg), "-i", str(norm),
         "-vf", vf, "-map", "0:v", "-map", "1:a", "-shortest", "-r", "30",
         "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
         "-c:a", "aac", "-b:a", "160k", str(final)],
        capture_output=True, text=True, check=True, cwd=str(workdir),
    )

    report("Миниатюра и метаданные", 92)
    thumb = workdir / "thumbnail.jpg"
    subprocess.run(
        ["ffmpeg", "-y", "-i", str(bg), "-vf", "scale=540:960", str(thumb)],
        capture_output=True, text=True, check=True,
    )

    return {
        "final": final, "thumbnail": thumb, "script": script,
        "duration_sec": round(duration, 1), "subtitle_style": "karaoke-ass",
        "voice": voice, "lang": lang, "words": len(words),
    }


# ----------------------------------------------------------------
# YouTube-метаданные для модерации
# ----------------------------------------------------------------

def youtube_metadata(article_title: str, script: dict, article_url: str) -> dict:
    """Заголовок/описание/теги — кандидат на выгрузку (privacyStatus=private)."""
    title = f"{_shorten(article_title, 68)} — рішення суду просто"
    description = (
        f"{script['hook']}\n\n{script['fabula']}\n\n{script['conclusion']}\n\n"
        f"Джерело: {article_url}\n\n"
        "#правосуддя #верховнийсуд #твоїправа #domdara #юридичнапросвіта"
    )
    tags = ["право", "суд", "Верховний Суд", "права людини", "прецедент",
            "юридична освіта", "domdara", "твої права"]
    return {"title": title, "description": description, "tags": tags, "categoryId": "25"}
