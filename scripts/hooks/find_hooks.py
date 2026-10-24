"""
Модуль поиска вирусных хуков (AI Hook Finder) в длинных YouTube-видео.
Аналог Opus Clip / Klap для друзей и блогеров.
Анализирует транскрипт Whisper и отбирает 3-5 лучших моментов для Shorts (35-55 сек).
"""

import math
import re
from typing import List, Dict, Any


def score_segment(text: str, duration: float) -> float:
    """
    Оценивает вирусность фрагмента (Virality Score 0-100) по 4 критериям:
    1. Наличие цепляющего хука в первых словах (вопрос, конфликт, интрига).
    2. Оптимальный хронометраж (35-55 сек — золотой стандарт Shorts).
    3. Плотность эмоциональных и правовых триггеров.
    4. Завершённость мысли (заканчивается точкой, вопросительным или восклицательным знаком).
    """
    score = 70.0  # Базовый балл

    # Критерий 1: Оптимальная длительность (35-55 сек)
    if 35.0 <= duration <= 55.0:
        score += 15.0
    elif 25.0 <= duration <= 60.0:
        score += 8.0
    else:
        score -= 20.0

    # Критерий 2: Цепляющие слова в начале (хуки)
    first_words = " ".join(text.split()[:8]).lower()
    hook_patterns = [
        r"почему", r"как так", r"вы не поверите", r"суд", r"судья", r"прокурор",
        r"незаконн", r"нарушен", r"отказ", r"внимание", r"скандал", r"шок",
        r"сроки истекли", r"макулатур", r"доказ", r"правд", r"чому", r"увага"
    ]
    for hp in hook_patterns:
        if re.search(hp, first_words):
            score += 12.0
            break

    # Критерий 3: Юридические и эмоциональные триггеры
    triggers = [
        "статья", "стаття", "кпк", "конституц", "ксу", "решение", "рішення",
        "документ", "протокол", "акт", "адвокат", "права", "обязан", "не имеет права"
    ]
    text_lower = text.lower()
    trigger_count = sum(1 for t in triggers if t in text_lower)
    score += min(trigger_count * 2.5, 10.0)

    # Критерий 4: Завершённость мысли (знак препинания в конце)
    text_trimmed = text.strip()
    if text_trimmed and text_trimmed[-1] in ".!?…":
        score += 5.0
    else:
        score -= 5.0

    return min(max(round(score, 1), 60.0), 99.0)


def generate_suggested_title(text: str) -> str:
    """Генерирует кликбейтный заголовок для Shorts на основе содержания."""
    text_lower = text.lower()
    if "строк" in text_lower or "термін" in text_lower:
        return "Сроки следствия истекли! Разнос в суде"
    if "макулатур" in text_lower or "документ" in text_lower:
        return "Судья отказалась принимать эти бумаги!"
    if "акт" in text_lower or "дати" in text_lower:
        return "Ляп прокуратуры с датами документов!"
    if "статт" in text_lower or "статья" in text_lower:
        return "Грубое нарушение статьи УПК в суде!"
    if "ксу" in text_lower or "конституц" in text_lower:
        return "Решение КСУ: чиновники превысили полномочия!"

    # Фоллбэк: первые 5-6 слов с восклицанием
    words = text.split()[:6]
    title = " ".join(words).strip(".,!?:;")
    return f"{title.capitalize()}!"


def find_best_hooks(segments: List[Dict[str, Any]], max_candidates: int = 3) -> List[Dict[str, Any]]:
    """
    Группирует мелкие фразы Whisper в связные блоки по 35-55 секунд
    и выбирает топ кандидатов с наивысшим баллом вирусности.
    """
    if not segments:
        return []

    candidates = []
    n = len(segments)

    # Скользящее окно по фразам
    for i in range(n):
        start_time = segments[i]["start"]
        text_accum = []

        for j in range(i, n):
            text_accum.append(segments[j]["text"].strip())
            end_time = segments[j]["end"]
            dur = end_time - start_time

            # Ищем отрезки в диапазоне 35-55 сек
            if 35.0 <= dur <= 55.0:
                combined_text = " ".join(text_accum)
                virality = score_segment(combined_text, dur)
                title = generate_suggested_title(combined_text)

                candidates.append({
                    "start": round(start_time, 2),
                    "end": round(end_time, 2),
                    "duration": round(dur, 1),
                    "virality_score": virality,
                    "title": title,
                    "text": combined_text,
                    "quote": (combined_text[:120] + "...") if len(combined_text) > 120 else combined_text,
                })
            elif dur > 55.0:
                break

    if not candidates:
        # Если видео короткое, берём всё видео целиком
        total_dur = segments[-1]["end"] - segments[0]["start"]
        full_text = " ".join(s["text"].strip() for s in segments)
        return [{
            "start": round(segments[0]["start"], 2),
            "end": round(segments[-1]["end"], 2),
            "duration": round(total_dur, 1),
            "virality_score": 85.0,
            "title": generate_suggested_title(full_text),
            "text": full_text,
            "quote": full_text[:120] + "...",
        }]

    # Сортируем по убыванию вирусности
    candidates.sort(key=lambda x: x["virality_score"], reverse=True)

    # Фильтруем дубликаты (чтобы кандидаты не перекрывались по таймкодам более чем на 15 сек)
    chosen = []
    for c in candidates:
        is_overlapping = False
        for ch in chosen:
            # Проверка пересечения временных отрезков
            overlap = max(0, min(c["end"], ch["end"]) - max(c["start"], ch["start"]))
            if overlap > 15.0:
                is_overlapping = True
                break
        if not is_overlapping:
            chosen.append(c)
            if len(chosen) >= max_candidates:
                break

    return chosen


if __name__ == "__main__":
    # Тестовые данные фраз Whisper
    demo_segments = [
        {"start": 0.0, "end": 5.0, "text": "Судья отказалась принимать макулатуру прокурора в судебном заседании."},
        {"start": 5.1, "end": 12.0, "text": "Прокурор пытался приобщить документы, которые не были открыты защите по статье 290."},
        {"start": 12.2, "end": 22.0, "text": "Сергей Величко указал на прямое нарушение уголовного процессуального кодекса Украины."},
        {"start": 22.1, "end": 35.0, "text": "Если доказательства собраны с нарушением закона, они признаются недопустимыми."},
        {"start": 35.1, "end": 45.0, "text": "В итоге суд отказал стороне обвинения в удовлетворении этого ходатайства."},
        {"start": 45.2, "end": 52.0, "text": "Это важная победа правозащитников в деле по статье 114-1."},
    ]

    print("Анализ фраз и поиск вирусных хуков (Opus Clip сценарий)...")
    hooks = find_best_hooks(demo_segments, max_candidates=2)
    for idx, h in enumerate(hooks, 1):
        print(f"\n[Кандидат #{idx}] {h['title']}")
        print(f"Таймкод: {h['start']}s - {h['end']}s ({h['duration']} сек) | Вирусность: {h['virality_score']}%")
        print(f"Цитата: \"{h['quote']}\"")
