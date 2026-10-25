"""P3: Авто-дубляж RU⇄UA — edge-tts (уже в стеке новостей) + LLM-перевод.

Схема (та же, что у OpenShorts «dubbing», но на бесплатных компонентах):
  транскрипция (есть) → LLM-перевод реплик (OpenAI-совместимый ключ из .env)
  → edge-tts синтез голоса → оригинал приглушается до -11 dB, дуб сверху.

Перевод БЕЗ LLM невозможен качественно — поэтому DubUnavailable (мягкий skip,
задача завершается обычным звуком) вместо машинного калька. Всё остальное
(синтез, микш) работает и покрыто тестами.
"""
from __future__ import annotations

import subprocess
from pathlib import Path

# Голоса edge-tts, уже опробованные в news-конвейере
VOICES = {
    ("uk", "ru"): "ru-RU-DmitryNeural",
    ("uk", "ru_alt"): "ru-RU-SvetlanaNeural",
    ("ru", "uk"): "uk-UA-OstapNeural",
    ("ru", "uk_alt"): "uk-UA-PolinaNeural",
}

ORIGINAL_DB = -11.0  # оригинал под дубом — слышен «фоном», как в ТВ-переводах

FILLERS = ("е-е", "еээ", "эм", "ну ", "как би", "э-э", "mmm", "uh", "um")


class DubUnavailable(RuntimeError):
    """Дубляж недоступен (нет LLM-ключа/сети) — НЕ ошибка задачи, просто skip."""


def pick_voice(src_lang: str, dst_lang: str, alt: bool = False) -> str:
    key = (src_lang, dst_lang) if not alt else (src_lang, f"{dst_lang}_alt")
    try:
        return VOICES[(src_lang, dst_lang if not alt else f"{dst_lang}_alt")]
    except KeyError:
        return VOICES.get(key, "ru-RU-DmitryNeural")


def plan_dub(rows: list[dict]) -> list[dict]:
    """Отобрать реплики для перевода: убрать заполнители и слишком короткие."""
    out = []
    for r in rows:
        text = str(r.get("text", "")).strip()
        low = text.lower()
        if not text or len(text) < 12:
            continue
        if any(low.startswith(f.strip()) and len(low) < 24 for f in FILLERS):
            continue  # чистые «э-э»/«ну» — не переводим
        out.append({"start": float(r["start"]), "end": float(r["end"]),
                    "text": text})
    return out


def translate_lines(lines: list[str], src: str, dst: str,
                    api_key: str, base_url: str, model: str,
                    timeout: float = 45.0) -> list[str]:
    """Перевод реплик через OpenAI-совместимый LLM. Без ключа — DubUnavailable."""
    if not (api_key and base_url and model):
        raise DubUnavailable("Дубляж пропущен: не задан MONTAGE_LLM_API_KEY")
    import httpx

    joined = "\n".join(f"{i + 1}| {t}" for i, t in enumerate(lines))
    prompt = (
        f"Переведи каждую строку с {src} на {dst}. Сохрани нумерацию «N| текст». "
        "Стиль: живая устная речь для озвучки Shorts, коротко, без кавычек. "
        "Верни только строки.\n\n" + joined
    )
    try:
        r = httpx.post(
            f"{base_url.rstrip('/')}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}"},
            json={"model": model, "messages": [{"role": "user", "content": prompt}],
                  "temperature": 0.3},
            timeout=timeout,
        )
        r.raise_for_status()
        content = r.json()["choices"][0]["message"]["content"]
    except Exception as e:  # noqa: BLE001 — сеть/ключ/лимиты → мягкий skip
        raise DubUnavailable(f"LLM-перевод недоступен: {e}") from e

    out: dict[int, str] = {}
    for ln in content.splitlines():
        if "|" not in ln:
            continue
        num, _, text = ln.partition("|")
        try:
            out[int(num.strip())] = text.strip()
        except ValueError:
            continue
    if len(out) < len(lines):
        raise DubUnavailable("LLM вернул не все строки — пропускаем дубляж целиком")
    return [out[i + 1] for i in range(len(lines))]


async def synth_voice(text: str, voice: str, out: Path) -> Path:
    """Синтез одной фразы edge-tts (mp3). Асинхронный API — как в tts_narrator."""
    import edge_tts

    await edge_tts.Communicate(text, voice).save(str(out))
    return out


def build_dub_mix_cmd(video: Path, dub_wav: Path, out: Path,
                      original_db: float = ORIGINAL_DB) -> list[str]:
    """Оригинал приглушается, дуб идёт сверху; видео — stream copy."""
    filter_complex = (
        f"[0:a]volume={original_db}dB[orig];"
        "[1:a]volume=1.0[dub];"
        "[orig][dub]amix=inputs=2:duration=first:normalize=0,"
        "dynaudnorm=p=0.9:m=10[aout]"
    )
    return [
        "ffmpeg", "-y", "-i", str(video), "-i", str(dub_wav),
        "-filter_complex", filter_complex,
        "-map", "0:v", "-map", "[aout]",
        "-c:v", "copy", "-c:a", "aac", "-b:a", "192k",
        "-shortest", str(out),
    ]


def join_phrases(dub_parts: list[Path], out_wav: Path) -> Path:
    """Склеить фразы дуба с короткими паузами между репликами (0.15 c)."""
    if not dub_parts:
        raise DubUnavailable("нет синтезированных фраз")
    inputs: list[str] = []
    for p in dub_parts:
        inputs += ["-i", str(p)]
    n = len(dub_parts)
    filter_complex = "".join(
        f"[{i}:a]apad=pad_dur=0.15[a{i}];" for i in range(n)
    ) + "".join(f"[a{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[out]"
    subprocess.run(
        ["ffmpeg", "-y", *inputs, "-filter_complex", filter_complex,
         "-map", "[out]", "-ar", "44100", "-ac", "1", str(out_wav)],
        capture_output=True, text=True, check=True, timeout=300,
    )
    return out_wav
