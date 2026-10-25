"""Unit-тесты AI Hook Finder (hook_scorer) — без сети и БД.

Запуск:  python3 tests/test_hook_scorer.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "services" / "worker"))

from app.hook_scorer import (  # noqa: E402
    Candidate, build_windows, find_hooks, group_sentences, make_title, score_emotion,
    score_hook, select_diverse,
)

# Синтетическая транскрипция «заседания» (укр., ~8 минут в 24 предложениях)
# Фрагменты специально разного качества: с вопросом-хуком, с цифрами, с риторикой,
# со слабым началом («продовжую тему»), с обрывом.
SENTENCES = [
    (0.0, 6.5, "Вітаю всіх на черговому засіданні у справі про стягнення боргу."),
    (6.5, 14.0, "Чи можна повернути гроші, якщо расписки немає, а є тільки свідки?"),
    (14.0, 21.0, "Верховний Суд нещодавно відповів на це питання, і відповідь багатьох здивує."),
    (21.0, 30.0, "Позивач стверджував, що передав 150 тисяч гривень готівкою без жодних документів."),
    (30.0, 39.5, "Відповідач заперечував і казав, що це вигадка, аби його скомпрометувати."),
    (39.5, 48.0, "Суд дослідив листування у месенджерах і дійшов висновку про реальність боргу."),
    (48.0, 57.0, "Це рішення змінило практику: свідки тепер можуть підтвердити договір позики."),
    (57.0, 65.5, "Продовжую тему попереднього розгляду, про що я вже казав на початку."),
    (65.5, 73.0, "Також розглянули справу про субсидію, яку незаконно зняли з пенсіонерки."),
    (73.0, 82.0, "Суд скасував рішення управління соціального захисту і повернув виплати."),
    (82.0, 91.5, "Запам'ятайте: за законом субсидію не можна знімати без документальної перевірки."),
    (91.5, 100.0, "Наступна справа стосувалась квартири, яку відібрали за фальшиву довіреність."),
    (100.0, 109.0, "Нотаріус завірив документ померлої людини, але суд розкрив цю аферу."),
    (109.0, 118.0, "Право власності поновили, а шахраїв чекає кримінальна відповідальність."),
    (118.0, 127.0, "Скільки часу дає закон на оскарження? Шість місяців, і це критично важливо."),
    (127.0, 136.0, "Багато людей пропускають цей строк і втрачають можливість захистити права."),
    (136.0, 145.5, "Адвокат порадив подавати заяву навіть без повного пакета документів."),
    (145.5, 154.0, "Суд зобов'язаний прийняти заяву і лише потім перевіряти докази."),
    (154.0, 163.0, "Штраф за несплату комунальних послуг скасували як безпідставний."),
    (163.0, 172.0, "Управляюча компанія нарахувала пені за період воєнного стану."),
    (172.0, 181.0, "Верховний Суд підтвердив: під час війни пені нараховувати заборонено."),
    (181.0, 190.0, "Це прецедент, який захистить мільйони українців від незаконних нарахувань."),
    (190.0, 199.0, "Отже, юридична освіта рятує гроші, час і нерви в кожній такій ситуації."),
    (199.0, 208.0, "Дякую за увагу, деталі кожної справи є в описі під відео."),
]


def segs(rows):
    return [{"start": s, "end": e, "text": t} for s, e, t in rows]


def test_group_sentences():
    out = group_sentences(segs(SENTENCES))
    # мульти-предложение внутри одного сегмента допустимо разбивается (? внутри),
    # но склейка/потеря текста запрещены
    assert len(out) >= len(SENTENCES), f"предложения слились: {len(out)} < {len(SENTENCES)}"
    assert all(x["text"].strip() for x in out), "пустые предложения"
    joined = " ".join(x["text"] for x in out)
    for probe in ("расписки", "субсидію", "пені", "довіреність"):
        assert probe in joined, f"потерян текст: {probe}"
    # монотонность таймкодов
    for a, b in zip(out, out[1:]):
        assert a["end"] <= b["end"] + 0.01, "таймкоды не монотонны"
    print(f"OK  group_sentences: {len(out)} предложений, текст сохранён")


def test_windows_in_range():
    sents = group_sentences(segs(SENTENCES))
    wins = build_windows(sents, 35, 55)
    assert wins, "окна не построены"
    for w in wins:
        dur = w["end"] - w["start"]
        assert 31 <= dur <= 59, f"окно вне мягкого допуска: {dur:.1f}s"
    print(f"OK  build_windows: {len(wins)} окон в допуске 35±4..55±4 c")


def test_scores_and_ordering():
    cands = find_hooks(segs(SENTENCES), 35, 55, top=5)
    assert 1 <= len(cands) <= 5, f"неадекватное число кандидатов: {len(cands)}"
    scores = [c.score for c in cands]
    assert scores == sorted(scores, reverse=True), f"кандидаты не отсортированы: {scores}"
    for c in cands:
        assert 60 <= c.score <= 99, f"Virality Score вне 60..99: {c.score}"
        assert c.title, "пустой заголовок"
        assert c.quote, "пустая цитата"
        assert c.duration >= 31, f"длительность кандидата мала: {c.duration}"
    # разнообразие: пересечения < 30%
    for i, a in enumerate(cands):
        for b in cands[i + 1:]:
            inter = max(0.0, min(a.end, b.end) - max(a.start, b.start))
            assert inter / min(a.duration, b.duration) <= 0.30, "кандидаты пересекаются > 30%"
    print(f"OK  find_hooks: {len(cands)} кандидатов, scores={scores}")
    for c in cands[:3]:
        print(f"      #{c.rank} [{c.score}%] {c.title} | {c.quote[:60]}... | bd={c.breakdown}")


def test_hook_components():
    strong = score_hook("Чи можна повернути 150 тисяч гривень без расписки? Ви маєте це знати!")
    weak = score_hook("Отже, ми продовжуємо розгляд чергового питання порядку денного.")
    assert strong > weak + 15, f"хук не различается: {strong:.0f} vs {weak:.0f}"
    emo_strong = score_emotion("Суд скасував штраф, стягнув борг 150 тисяч гривень і захистив права пенсіонерки!")
    emo_weak = score_emotion("Тут ми поговоримо про різні загальні теми та питання порядку денного.")
    assert emo_strong > emo_weak + 15, f"эмоции не различаются: {emo_strong:.0f} vs {emo_weak:.0f}"
    print(f"OK  компоненты: hook {strong:.0f}>{weak:.0f}, emotion {emo_strong:.0f}>{emo_weak:.0f}")


def test_diversity_filter():
    c1 = Candidate(start=0, end=45, raw=90, score=95)
    c2 = Candidate(start=5, end=50, raw=88, score=93)   # почти дубликат
    c3 = Candidate(start=200, end=245, raw=80, score=91)
    out = select_diverse([c2, c1, c3], top=3)
    starts = [c.start for c in out]
    assert 5 not in starts, "дубликат не отфильтрован"
    assert 0 in starts and 200 in starts, "лучшие кандидаты потеряны"
    print("OK  select_diverse: дубликаты отсеяны")


def test_titles():
    t1 = make_title("Чи можна стягнути борг без расписки? Верховний Суд відповів так.")
    assert 10 <= len(t1) <= 72, f"заголовок странного размера: {len(t1)}"
    assert any(ch.isalpha() for ch in t1)
    print(f"OK  make_title: {t1!r}")


if __name__ == "__main__":
    test_group_sentences()
    test_windows_in_range()
    test_scores_and_ordering()
    test_hook_components()
    test_diversity_filter()
    test_titles()
    print("\n=== ВСЕ ТЕСТЫ HOOK_SCORER ПРОЙДЕНЫ ===")
