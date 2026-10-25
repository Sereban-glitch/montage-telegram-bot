"""AI Hook Finder & Scorer — интеллектуальное ядро Фичи №1.

Находит в длинном видео (интервью, стрим, заседание, 20–60 мин) фрагменты
заданной целевой длительности с максимальным вирусным потенциалом и оценивает
их Virality Score.

Метод (детерминированный, бесплатный, работает офлайн):
  1. Сегментация: реплики Whisper склеиваются в предложения; окно кандидата
     набирается целыми предложениями, длительность держится в [min_dur, max_dur].
  2. Четырёхкомпонентный скоринг (взвешенная сумма 0..100):
       hook         0.30 — сила первых 3 секунд (вопросы, цифры, провокация, «вы»)
       completeness 0.25 — завершённость мысли (старт/финиш на границе предложения,
                            нет висячих союзов и отсылок «как я говорил»)
       emotion      0.25 — эмоциональный накал и юридическая острота (лексикон)
       retention    0.20 — удержание: сладкая точка длительности (адаптивна под
                            target_duration), плотность речи,
                            штраф за паузы > 2.5 c внутри фрагмента
  3. Virality Score для показа пользователю: 58 + raw*0.41 → диапазон 60..99.
  4. Фильтр разнообразия: без пересечений > 30 % и без соседних стартов < gap.
  5. Заголовок — правило-шаблоны на ключевых фразах фрагмента.

Целевая длительность (отзыв владельца: «Почему 25–55 секунд, если Shorts в
YouTube уже до 3 минут?» — YouTube разрешил вертикальные видео до 180 с
с 15.10.2024):
    short    35–60 с   — быстрый клип для TikTok / Reels / классического Shorts
    standard 60–90 с   — стандартная мысль / комментарий
    deep     90–180 с  — «Глубокий Shorts» для судов, интервью, разборов

Опциональный LLM-рефайнер (если заданы MONTAGE_LLM_API_KEY/LLM_BASE_URL/LLM_MODEL):
переписывает заголовки и корректирует порядок — деградирует в правила без ключа.
"""
from __future__ import annotations

import json
import math
import os
import re
from dataclasses import dataclass, field

# ----------------------------------------------------------------
# Лексиконы (укр. основа + рус. дубли — заседания часто двуязычны)
# ----------------------------------------------------------------

QUESTION_WORDS = (
    "чому", "як ", "що буде", "що робити", "чи можна", "чи мав", "чи має", "чи законно",
    "хто ", "скільки", "коли ", "де ", "яке ", "яка ", "який ", "котрий",
    "почему", "как ", "что будет", "что делать", "можно ли", "кто ", "сколько", "когда",
)

PROVOCATION = (
    "ніколи", "ніхто", "ніхто не", "заборонено", "порушення", "шахрайство", "небезпечно",
    "терміново", "обережно", "шок", "правда", "брехня", "таємно", "секрет", "виявилося",
    "не вірили", "не знав", "не знали", "помилка", "помилку", "ризик", "загроза",
    "никогда", "никто", "запрещено", "нарушение", "мошенничество", "опасно", "срочно",
    "шок", "правда", "ложь", "тайно", "ошибк", "риск", "угроза",
)

SECOND_PERSON = ("ви ", "ваш", "вам", "вас ", "ви маєте", "тобі", "ти ", "твій", "твоя",
                 "вы ", "ваш", "вам", "вас ", "тебе", "ты ", "твой", "твоя")

# Юридическая/социальная острота — ядро ниши (суды, права граждан, деньги)
LEGAL_EMOTION = (
    "суд", "судд", "постанова", "рішення суду", "верховний", "касаційн", "апеляц",
    "право", "права", "права людини", "порушен", "скасували", "стягнут", "стягнути",
    "штраф", "ув’язнення", "увязнення", "арешт", "борг", "кредит", "квартира", "житло",
    "пенсія", "субсидія", "виплат", "грош", "гривень", "мільйон", "компенсац",
    "корупц", "свавілля", "беззакон", "захист", "позов", "адвокат", "вирок",
    "прокуратур", "поліц", "діяння", "відповідал", "відшкодуван", "прецедент",
    "суд", "постанов", "решение", "верховн", "кассац", "апелляц", "права",
    "нарушен", "отмен", "взыскат", "штраф", "арест", "долг", "кредит", "квартир",
    "пенси", "субсиди", "выплат", "деньг", "миллион", "коррупц", "произвол",
    "беззакони", "защит", "иск ", "адвокат", "приговор", "прокуратур", "полиц",
)

CONTINUATION_MARKERS = (  # фрагмент начинается как продолжение мысли — плохо для Shorts
    "і тому", "й тому", "тому що", "а тому", "продовж", "як я ", "як ми ", "про це я ",
    "про це вже", "наступн", "попередн", "він сказав", "вона сказала", "ось це ",
    "и поэтому", "потому что", "продолж", "как я ", "как мы ", "об этом я ", "об этом уже",
)

DANGLING_ENDINGS = ("і", "й", "та", "або", "чи", "що", "як", "але", "та й", "а саме")


# ----------------------------------------------------------------
# Целевая длительность готовых Shorts (синхронно с DurationPicker в Mini App)
# ----------------------------------------------------------------

# Пресеты: target_duration → (min_dur, max_dur) в секундах.
# ⚡ short    «До 60 сек»   — быстрый клип: TikTok / Reels / классический Shorts
# ⏱️ standard «60–90 сек»  — стандартная мысль / комментарий
# 🎬 deep     «До 3 минут»  — Глубокий Shorts: суды, интервью (YouTube Shorts 2026)
DURATION_PRESETS: dict[str, tuple[float, float]] = {
    "short": (35.0, 60.0),
    "standard": (60.0, 90.0),
    "deep": (90.0, 180.0),
}

DEFAULT_TARGET_DURATION = "short"


def resolve_duration(target_duration: str | None) -> tuple[float, float]:
    """target_duration из params задачи → (min_dur, max_dur) с защитой от мусора."""
    key = (target_duration or DEFAULT_TARGET_DURATION).strip().lower()
    return DURATION_PRESETS.get(key, DURATION_PRESETS[DEFAULT_TARGET_DURATION])


def _sweet_spot(min_dur: float, max_dur: float) -> tuple[float, float]:
    """Сладкая точка удержания под пресет.

    Для дефолтного short (35–60) — ровно прежние константы (44 с / 7 с),
    чтобы поведение по умолчанию не изменилось ни на йоту. Для остальных
    пресетов центр чуть ниже середины диапазона, сигма пропорциональна ширине.
    """
    if (min_dur, max_dur) == DURATION_PRESETS["short"]:
        return 44.0, 7.0
    center = min_dur + (max_dur - min_dur) * 0.45
    center = max(38.0, min(center, 150.0))
    sigma = max(6.0, (max_dur - min_dur) / 6.0)
    return center, sigma


# ----------------------------------------------------------------
# Модель кандидата
# ----------------------------------------------------------------

@dataclass
class Candidate:
    rank: int = 0
    start: float = 0.0
    end: float = 0.0
    text: str = ""
    hook_text: str = ""          # текст первых ~3 секунд
    title: str = ""
    title_variants: list[str] = field(default_factory=list)  # A/B/C для карточек (P2)
    quote: str = ""
    score: int = 0               # Virality Score 60..99 (для показа)
    raw: float = 0.0             # сырой скор 0..100
    breakdown: dict = field(default_factory=dict)

    @property
    def duration(self) -> float:
        return round(self.end - self.start, 2)

    def to_dict(self) -> dict:
        return {
            "rank": self.rank, "start": round(self.start, 2), "end": round(self.end, 2),
            "duration": self.duration, "title": self.title, "quote": self.quote,
            "score": self.score, "raw": round(self.raw, 1), "breakdown": self.breakdown,
            "text": self.text, "title_variants": self.title_variants,
        }


# ----------------------------------------------------------------
# Нормализация и разбиение на предложения
# ----------------------------------------------------------------

_WORD_RE = re.compile(r"[А-Яа-яЄєІіЇїҐґA-Za-z’']+")


def _words(text: str) -> list[str]:
    return _WORD_RE.findall(text.lower())


def group_sentences(segments: list[dict]) -> list[dict]:
    """Whisper-сегменты → предложения (границы по .!?…).

    Каждый sentence: {start, end, text}. Сегменты короче 0.4 c склеиваются с соседями,
    чтобы шум VAD не порождал микро-предложений.
    """
    sentences: list[dict] = []
    for seg in segments:
        text = (seg.get("text") or "").strip()
        if not text:
            continue
        start, end = float(seg.get("start", 0)), float(seg.get("end", 0))
        if not sentences:
            sentences.append({"start": start, "end": end, "text": text})
            continue
        prev = sentences[-1]
        # незавершённое предыдущее предложение + короткий сегмент → склейка
        unfinished = prev["text"][-1:] not in ".!?…"
        if (end - start < 0.4 or unfinished) and start - prev["end"] < 1.2:
            prev["end"] = end
            prev["text"] = (prev["text"] + " " + text).strip()
        else:
            sentences.append({"start": start, "end": end, "text": text})
    # финальное разбиение по знакам внутри длинных склеек
    out: list[dict] = []
    for s in sentences:
        parts = re.split(r"(?<=[.!?…])\s+", s["text"].strip())
        if len(parts) <= 1:
            out.append(s)
            continue
        span = max(0.01, s["end"] - s["start"])
        per = max(0.01, span / len(parts))
        for i, p in enumerate(parts):
            if p:
                out.append({"start": round(s["start"] + i * per, 2),
                            "end": round(s["start"] + (i + 1) * per, 2), "text": p})
    return out


# ----------------------------------------------------------------
# Генерация окон-кандидатов
# ----------------------------------------------------------------

def build_windows(sentences: list[dict], min_dur: float = 35.0, max_dur: float = 55.0) -> list[dict]:
    """Скользящее окно целыми предложениями: [min_dur, max_dur] с мягким допуском ±4 с.

    Возвращает список {start, end, sentences, text}.
    """
    windows: list[dict] = []
    n = len(sentences)
    for i in range(n):
        total = 0.0
        parts: list[str] = []
        for j in range(i, n):
            s = sentences[j]
            total += s["end"] - s["start"]
            parts.append(s["text"])
            dur = s["end"] - sentences[i]["start"]
            if dur >= max_dur:
                break
        dur = sentences[min(j, n - 1)]["end"] - sentences[i]["start"]
        if min_dur - 4.0 <= dur <= max_dur + 4.0:
            windows.append({
                "start": sentences[i]["start"],
                "end": sentences[min(j, n - 1)]["end"],
                "text": " ".join(parts).strip(),
            })
    return windows


# ----------------------------------------------------------------
# Компоненты скоринга (каждый 0..100)
# ----------------------------------------------------------------

def _count_hits(words: list[str], phrases: tuple[str, ...], text: str) -> int:
    hits = 0
    for ph in phrases:
        if ph in text:
            hits += sum(1 for w in words if w.startswith(ph.strip()))
    return hits


def score_hook(hook_text: str) -> float:
    """Сила первых 3 секунд: вопрос/цифра/провокация/обращение к зрителю."""
    text = hook_text.lower()
    words = _words(text)
    if not words:
        return 0.0
    score = 22.0  # базовая линия: любой осмысленный старт
    if "?" in hook_text:
        score += 18
    if any(text.strip().startswith(q.strip()) for q in QUESTION_WORDS):
        score += 16
    if re.search(r"\d", hook_text):
        score += 12
    score += min(18.0, _count_hits(words, PROVOCATION, text) * 7)
    score += min(14.0, _count_hits(words, SECOND_PERSON, text) * 6)
    # первые 3 секунды, сказанные шёпотом/неразборчиво (очень короткие), — штраф
    if len(words) < 4:
        score -= 10
    return max(0.0, min(100.0, score))


def score_completeness(window: dict, sentences: list[dict]) -> float:
    """Завершённость мысли: старт с начала предложения, финал на точке, без висяков."""
    text = window["text"].strip()
    words = _words(text)
    score = 50.0
    first = text[:1]
    if first.isupper():
        score += 12
    if text[-1:] in ".!?…":
        score += 20
    elif text[-1:] in ",;:-":
        score -= 18
    low_start = text.lower()[:14]
    if any(low_start.startswith(m) for m in CONTINUATION_MARKERS):
        score -= 22
    last_word = words[-1] if words else ""
    if last_word in DANGLING_ENDINGS or last_word in ("щоб", "бо", "йбо", "чтобы", "потому"):
        score -= 20
    # мыслимая длина: 60+ слов = связный кусок; <35 — обрывок
    if len(words) >= 60:
        score += 12
    elif len(words) < 35:
        score -= 12
    # вопрос в конце фрагмента удерживает зрителя (клиффхэнгер)
    if text[-1:] == "?":
        score += 8
    return max(0.0, min(100.0, score))


def score_emotion(text: str) -> float:
    """Эмоциональный накал + юридическая острота."""
    words = _words(text)
    if not words:
        return 0.0
    score = 20.0
    score += min(40.0, _count_hits(words, LEGAL_EMOTION, text) * 4.5)
    score += min(15.0, text.count("!") * 5)
    # прямая речь/цитатность — живой материал
    if "«" in text or '"' in text or " — " in text:
        score += 8
    # длительные оценки и споры (модальность)
    modal = sum(1 for w in words if w in ("має", "повинен", "зобов", "не може", "неможливо",
                                          "должен", "обязан", "не может"))
    score += min(12.0, modal * 4)
    density = _count_hits(words, LEGAL_EMOTION, text) / max(1, len(words))
    if density < 0.03:
        score -= 10  # фрагмент ни о чём юридически
    return max(0.0, min(100.0, score))


def score_retention(window: dict, sentences: list[dict], center: float = 44.0,
                    sigma: float = 7.0) -> float:
    """Удержание: длительность (адаптивная сладкая точка), плотность речи, паузы."""
    dur = window["end"] - window["start"]
    # гауссиана вокруг сладкой точки пресета (44 c для short, ~73 c для standard, ~132 c для deep)
    dur_score = 100.0 * math.exp(-((dur - center) ** 2) / (2 * sigma ** 2))
    words = _words(window["text"])
    wps = len(words) / max(1.0, dur)  # слов в секунду
    if wps >= 1.8 and wps <= 3.2:
        density_score = 100.0
    elif wps < 1.2 or wps > 4.5:
        density_score = 35.0
    else:
        density_score = 70.0
    # максимальная пауза внутри окна
    inner = [s for s in sentences if s["start"] >= window["start"] - 0.01 and s["end"] <= window["end"] + 0.01]
    max_gap = 0.0
    for a, b in zip(inner, inner[1:]):
        max_gap = max(max_gap, b["start"] - a["end"])
    pause_score = 100.0 if max_gap < 1.5 else (70.0 if max_gap < 2.5 else 35.0)
    return max(0.0, min(100.0, 0.45 * dur_score + 0.35 * density_score + 0.20 * pause_score))


# ----------------------------------------------------------------
# Кликбейтный заголовок (правило-шаблоны)
# ----------------------------------------------------------------

_TEMPLATES = (
    "Що вирішив суд: {key}",
    "Це змінює все: {key}",
    "Ви маєте це знати: {key}",
    "Суд став крапку: {key}",
    "Прецедент, який захистить вас: {key}",
)


def _keyphrase(text: str, max_len: int = 52) -> str:
    """Ключевая фраза: предложение с максимальной плотностью триггеров, обрез до слов."""
    best, best_score = "", -1.0
    for sent in re.split(r"(?<=[.!?…])\s+", text):
        sent = sent.strip()
        if len(sent) < 15:
            continue
        w = _words(sent)
        s = _count_hits(w, LEGAL_EMOTION, sent.lower()) * 2 + _count_hits(w, PROVOCATION, sent.lower()) * 3
        s += 3 if "?" in sent else 0
        if s > best_score:
            best, best_score = sent, s
    if not best:
        best = text.strip()
    key = best.rstrip(".!?… ").strip()
    key = re.sub(r"\s+", " ", key)
    if len(key) > max_len:
        cut = key[:max_len].rsplit(" ", 1)[0]
        key = cut + "…"
    return key


def make_title(text: str) -> str:
    key = _keyphrase(text)
    # детерминированный выбор шаблона по содержимому
    if "?" in text[:120]:
        tpl = _TEMPLATES[1]
    elif _count_hits(_words(text.lower()), LEGAL_EMOTION, text.lower()) >= 6:
        tpl = _TEMPLATES[4]
    elif re.search(r"\d", text[:120]):
        tpl = _TEMPLATES[3]
    else:
        tpl = _TEMPLATES[0]
    title = tpl.format(key=key)
    return title[:70] + "…" if len(title) > 72 else title


def make_title_variants(text: str, base_title: str, max_len: int = 72) -> list[str]:
    """P2: три варианта названия A/B/C — как «10 названий» OpenShorts, но без перегруза.

    A — базовый (вопрос/провокация), B — другая рамка (смена шаблона),
    C — короткий панч: сама ключевая фраза без префикса.
    """
    key = _keyphrase(text)
    base_tpl = None
    for tpl in _TEMPLATES:
        if tpl.format(key=key) == base_title:
            base_tpl = tpl
            break
    variants: list[str] = [base_title]
    # B: следующий по контексту шаблон
    for tpl in _TEMPLATES:
        cand = tpl.format(key=key)
        if base_tpl and tpl == base_tpl:
            continue
        if cand != base_title and len(cand) <= max_len:
            variants.append(cand[:max_len])
            break
    # C: голая ключевая фраза — «короткий панч»
    punch = key[:max_len]
    if punch and punch.lower() not in (v.lower() for v in variants):
        variants.append(punch)
    # страховка длины
    return [v[:max_len] + ("…" if len(v) > max_len else "") for v in variants[:3]]


# ----------------------------------------------------------------
# Фильтр разнообразия + итоговый отбор
# ----------------------------------------------------------------

def _overlap(a: Candidate, b: Candidate) -> float:
    inter = max(0.0, min(a.end, b.end) - max(a.start, b.start))
    return inter / max(1.0, min(a.duration, b.duration))


def select_diverse(scored: list[Candidate], top: int = 5, min_gap: float = 60.0) -> list[Candidate]:
    chosen: list[Candidate] = []
    for cand in sorted(scored, key=lambda c: c.raw, reverse=True):
        if any(_overlap(cand, c) > 0.30 for c in chosen):
            continue
        if any(abs(cand.start - c.start) < min_gap for c in chosen):
            continue
        chosen.append(cand)
        if len(chosen) >= top:
            break
    return chosen


def _adaptive_gap(scored: list[Candidate], top: int) -> float:
    """Мин. дистанция стартов: 60 c для длинных видео, мягче для коротких,
    чтобы меню всегда собирало 3–5 кандидатов."""
    if not scored:
        return 60.0
    span = max(c.end for c in scored) - min(c.start for c in scored)
    return max(22.0, min(60.0, span / 12.0))


# ----------------------------------------------------------------
# Основной API
# ----------------------------------------------------------------

def find_hooks(segments: list[dict], min_dur: float = 35.0, max_dur: float = 55.0,
               top: int = 5, target_duration: str | None = None) -> list[Candidate]:
    """Whisper-сегменты → топ-N кандидатов с Virality Score.

    segments: [{"start": float, "end": float, "text": str}, ...]
    target_duration: 'short' (35–60 с) | 'standard' (60–90 с) | 'deep' (90–180 с).
    Если задан — перекрывает min_dur/max_dur пресетом из DURATION_PRESETS.
    """
    if target_duration:
        min_dur, max_dur = resolve_duration(target_duration)
    center, sigma = _sweet_spot(min_dur, max_dur)
    sentences = group_sentences(segments)
    windows = build_windows(sentences, min_dur=min_dur, max_dur=max_dur)
    scored: list[Candidate] = []
    for w in windows:
        dur = w["end"] - w["start"]
        if dur < min_dur - 4 or dur > max_dur + 4:
            continue
        # первые ~3 секунды текста = хук (по словам с пропорцией времени)
        hook_text = _hook_slice(w, sentences)
        b_hook = score_hook(hook_text)
        b_comp = score_completeness(w, sentences)
        b_emo = score_emotion(w["text"])
        b_ret = score_retention(w, sentences, center=center, sigma=sigma)
        raw = 0.30 * b_hook + 0.25 * b_comp + 0.25 * b_emo + 0.20 * b_ret
        score = int(max(60, min(99, round(58 + raw * 0.41))))
        scored.append(Candidate(
            start=w["start"], end=w["end"], text=w["text"], hook_text=hook_text,
            title=make_title(w["text"]), quote=_first_sentence(w["text"]),
            score=score, raw=raw,
            breakdown={"hook": round(b_hook), "completeness": round(b_comp),
                       "emotion": round(b_emo), "retention": round(b_ret)},
        ))
    top_list = select_diverse(scored, top=top, min_gap=_adaptive_gap(scored, top))
    # страховка: если после фильтра осталось мало — добираем лучшими без дистанции
    if len(top_list) < min(3, len(scored)):
        picked_ids = {(c.start, c.end) for c in top_list}
        for cand in sorted(scored, key=lambda c: c.raw, reverse=True):
            if (cand.start, cand.end) in picked_ids:
                continue
            if any(_overlap(cand, c) > 0.30 for c in top_list):
                continue
            top_list.append(cand)
            if len(top_list) >= min(3, len(scored)):
                break
        top_list = sorted(top_list, key=lambda c: c.raw, reverse=True)
    for i, c in enumerate(top_list, start=1):
        c.rank = i
        c.title_variants = make_title_variants(c.text, c.title)
    return top_list


def _hook_slice(window: dict, sentences: list[dict]) -> str:
    limit = window["start"] + 3.0
    parts = [s["text"] for s in sentences
             if s["start"] >= window["start"] - 0.01 and s["start"] < limit]
    if not parts:
        words = window["text"].split()
        parts = [" ".join(words[: max(4, int(len(words) * 0.18))])]
    return " ".join(parts).strip()


def _first_sentence(text: str, max_len: int = 140) -> str:
    sent = re.split(r"(?<=[.!?…])\s+", text.strip())[0]
    if len(sent) > max_len:
        sent = sent[:max_len].rsplit(" ", 1)[0] + "…"
    return sent


# ----------------------------------------------------------------
# Опциональный LLM-рефайнер (не обязателен: без ключа работает по правилам)
# ----------------------------------------------------------------

def llm_refine(candidates: list[Candidate]) -> list[Candidate]:
    """Если задан OpenAI-совместимый LLM (MONTAGE_LLM_API_KEY + MONTAGE_LLM_BASE_URL +
    MONTAGE_LLM_MODEL) — просим модель переписать заголовки. Любая ошибка → тихий
    возврат правило-версии."""
    api_key = os.getenv("MONTAGE_LLM_API_KEY", "")
    base = os.getenv("MONTAGE_LLM_BASE_URL", "")
    model = os.getenv("MONTAGE_LLM_MODEL", "")
    if not (api_key and base and model):
        return candidates
    try:
        import httpx

        prompt = {
            "role": "user",
            "content": (
                "Ти редактор YouTube Shorts українською. Для кожного фрагмента придумай "
                "клікбейтний заголовок до 60 символів (без емодзі). Верни JSON-масив рядків "
                "у тому ж порядку. Фрагменти:\n"
                + "\n".join(f"{i+1}. {c.text[:400]}" for i, c in enumerate(candidates))
            ),
        }
        r = httpx.post(
            f"{base.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model, "messages": [prompt], "temperature": 0.7},
            timeout=30,
        )
        r.raise_for_status()
        titles = json.loads(r.json()["choices"][0]["message"]["content"])
        if isinstance(titles, list) and len(titles) == len(candidates):
            for c, t in zip(candidates, titles):
                if isinstance(t, str) and t.strip():
                    c.title = t.strip()[:72]
    except Exception:  # noqa: BLE001 — LLM опционален, падение не критично
        pass
    return candidates
