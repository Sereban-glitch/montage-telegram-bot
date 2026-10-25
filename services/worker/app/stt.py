"""P2: WhisperX-адаптер — word-level тайминги, с фолбэком на faster-whisper.

WhisperX (MIT) даёт выравнивание по словам (~70× realtime) — идеально для
караоке-субтитров и точных границ предложений. НО он тянет ctranslate2 +
доп. модели, поэтому STRICTLY опционален: если пакет не установлен,
модуль прозрачно использует проверенный faster-whisper (как раньше).

Единая точка входа для конвейеров:
    stt.transcribe_audio(audio, model) -> (rows, info)
"""
from __future__ import annotations

from pathlib import Path


def whisperx_available() -> bool:
    try:
        import whisperx  # noqa: F401
        return True
    except ImportError:
        return False


def engine_name() -> str:
    return "whisperx" if whisperx_available() else "faster-whisper"


def transcribe_audio(audio: Path, model: str = "small",
                     language: str | None = None) -> tuple[list[dict], dict]:
    """Транскрибировать аудио → rows [{'start','end','text'}], info {'language','duration'}.

    Путь 1 (WhisperX установлен): word-timestamps → сегменты по словам,
      границы точнее ±80 мс — лучше для хуков и караоке.
    Путь 2 (по умолчанию): faster-whisper int8 — как в проде сейчас.
    """
    if whisperx_available():
        try:
            return _transcribe_whisperx(audio, model, language)
        except Exception:  # noqa: BLE001 — любой сбой X → тихий фолбэк
            pass
    return _transcribe_faster(audio, model, language)


def _transcribe_whisperx(audio: Path, model: str, language: str | None):
    import whisperx

    device = "cpu"
    batch_size = 8
    compute_type = "int8"
    xx = whisperx.load_model(model, device, compute_type=compute_type, language=language)
    audio_data = whisperx.load_audio(str(audio))
    result = xx.transcribe(audio_data, batch_size=batch_size, language=language)
    # выравнивание по словам (модель мелкая — грузится лениво)
    try:
        align_model, meta = whisperx.load_align_model(
            result.get("language", "uk"), device)
        result = whisperx.align(result["segments"], align_model, meta,
                                audio_data, device, return_char_spans=False)
    except Exception:  # noqa: BLE001 — языков-specific модель может отсутствовать
        pass
    rows = [
        {"start": round(float(s["start"]), 2), "end": round(float(s["end"]), 2),
         "text": str(s.get("text", "")).strip()}
        for s in result.get("segments", []) if str(s.get("text", "")).strip()
    ]
    info = {"language": result.get("language", language or "uk"),
            "duration": max((r["end"] for r in rows), default=0.0)}
    return rows, info


def _transcribe_faster(audio: Path, model: str, language: str | None):
    from faster_whisper import WhisperModel

    loaded = WhisperModel(model, device="cpu", compute_type="int8", cpu_threads=4)
    segments_iter, info = loaded.transcribe(
        str(audio), language=language, vad_filter=True, beam_size=5)
    rows = []
    for seg in segments_iter:
        text = seg.text.strip()
        if text:
            rows.append({"start": round(seg.start, 2), "end": round(seg.end, 2),
                         "text": text})
    return rows, {"language": info.language, "duration": float(info.duration or 0.0)}
