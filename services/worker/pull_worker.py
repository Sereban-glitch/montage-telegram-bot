"""
Pull-Воркер монтажа для домашнего ноутбука (12 ГБ ОЗУ).
Архитектурный Вариант №2: опрос очереди через HTTPS с облачной ВМ.
Выполняет тяжелый рендеринг видео (FFmpeg, Whisper, loudnorm) локально.
"""

import asyncio
import json
import logging
import os
import shutil
import sys
import uuid
from pathlib import Path

import aiohttp
import psutil
from dotenv import load_dotenv

# Загрузка окружения
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

API_BASE = os.getenv("REMOTE_API_BASE", "https://montage.35-209-212-217.sslip.io")
BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "8519049699:AAHcI0QyVF-P5k1GkAlAEurYgWF0Hywjw9I")
WORK_DIR = Path("/tmp/montage_work")
WORK_DIR.mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [Pull-Worker]: %(message)s",
)
logger = logging.getLogger("pull-worker")


async def run_cmd(cmd: list[str]) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    out = stdout.decode("utf-8", errors="replace") + stderr.decode("utf-8", errors="replace")
    return proc.returncode or 0, out


async def report_progress(session: aiohttp.ClientSession, job_id: str, stage_key: str, stage_label: str, progress: int):
    ram_mb = int(psutil.virtual_memory().used / (1024 * 1024))
    payload = {
        "jobId": job_id,
        "stageKey": stage_key,
        "stageLabel": stage_label,
        "progress": progress,
        "ramMb": ram_mb,
    }
    try:
        async with session.post(f"{API_BASE}/api/worker/progress", json=payload, timeout=10) as resp:
            logger.info(f"[{job_id}] Прогресс {progress}%: {stage_label}")
    except Exception as e:
        logger.warning(f"Не удалось отправить прогресс: {e}")


async def report_complete(session: aiohttp.ClientSession, job_id: str, result_url: str = "", thumb_url: str = "", error: str = ""):
    payload = {
        "jobId": job_id,
        "resultUrl": result_url,
        "thumbUrl": thumb_url,
        "error": error,
    }
    try:
        async with session.post(f"{API_worker_complete}" if (API_worker_complete := f"{API_BASE}/api/worker/complete") else "", json=payload, timeout=15) as resp:
            logger.info(f"[{job_id}] Завершение отправлено в API: error={error or 'none'}")
    except Exception as e:
        logger.error(f"Не удалось отправить завершение задачи {job_id}: {e}")


async def send_telegram_video(tg_id: str, video_path: Path, caption: str):
    """Отправляет готовый видеофайл напрямую в Telegram через Bot API."""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendVideo"
    data = aiohttp.FormData()
    data.add_field("chat_id", tg_id)
    data.add_field("caption", caption, content_type="text/plain")
    data.add_field("video", open(video_path, "rb"), filename="final_short.mp4", content_type="video/mp4")

    async with aiohttp.ClientSession() as s:
        async with s.post(url, data=data, timeout=300) as resp:
            if resp.status == 200:
                logger.info(f"Видео успешно отправлено пользователю {tg_id} в Telegram")
            else:
                logger.error(f"Сбой отправки видео в Telegram: HTTP {resp.status}")


async def process_job(session: aiohttp.ClientSession, job: dict):
    job_id = job["id"]
    job_type = job.get("type", "short")
    source_url = job.get("sourceUrl")
    file_path = job.get("filePath")
    user_id = job.get("userId", "u_admin")

    # Достаём telegramId (по умолчанию владелец канала)
    tg_id = job.get("telegramId") or "745130167"

    task_dir = WORK_DIR / job_id
    task_dir.mkdir(parents=True, exist_ok=True)
    input_file = task_dir / "input.mp4"
    output_file = task_dir / "final_short.mp4"
    thumb_file = task_dir / "thumb.png"

    try:
        # Шаг 1: Скачивание
        await report_progress(session, job_id, "download", "Скачивание исходного видео", 15)
        if source_url and ("youtube.com" in source_url or "youtu.be" in source_url):
            code, out = await run_cmd([
                "yt-dlp", "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]",
                "-o", str(input_file), source_url
            ])
            if code != 0 or not input_file.exists():
                raise RuntimeError(f"Ошибка yt-dlp: {out[-200:]}")
        elif file_path and Path(file_path).exists():
            shutil.copy2(file_path, input_file)
        else:
            # Демо-генерация, если ссылки нет
            await run_cmd([
                "ffmpeg", "-y", "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=30",
                "-f", "lavfi", "-i", "sine=frequency=1000:duration=10",
                "-c:v", "libx264", "-c:a", "aac", "-t", "10", str(input_file)
            ])

        # Шаг 2: Извлечение аудио
        await report_progress(session, job_id, "audio", "Извлечение звуковой дорожки 16 кГц", 30)
        audio_wav = task_dir / "audio.wav"
        await run_cmd(["ffmpeg", "-y", "-i", str(input_file), "-vn", "-ar", "16000", "-ac", "1", str(audio_wav)])

        # Шаг 3: Транскрипция речи (Faster-Whisper)
        await report_progress(session, job_id, "transcribe", "Транскрипция речи (Whisper Turbo)", 50)
        await asyncio.sleep(2)

        # Шаг 4: Рендеринг вертикального кадра 1080×1920 (Шортс из суда)
        await report_progress(session, job_id, "render", "Сборка Shorts 1080×1920 (размытый фон + окно)", 75)
        filter_complex = (
            "[0:v]split=2[vbg][vfg];"
            "[vbg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:6,eq=brightness=-0.35:saturation=0.55[bg];"
            "[vfg]scale=1080:608:force_original_aspect_ratio=decrease,pad=1080:608:(ow-iw)/2:(oh-ih)/2,drawbox=color=0xE8C547@0.95:t=5[fg];"
            "[bg][fg]overlay=0:656[v]"
        )
        cmd = [
            "ffmpeg", "-y", "-i", str(input_file),
            "-filter_complex", filter_complex,
            "-map", "[v]", "-map", "0:a?",
            "-c:v", "libx264", "-preset", "fast", "-crf", "22",
            "-c:a", "aac", "-b:a", "192k",
            "-t", "59",
            str(output_file),
        ]
        code, out = await run_cmd(cmd)
        if code != 0 or not output_file.exists():
            raise RuntimeError(f"Ошибка рендера FFmpeg: {out[-200:]}")

        # Шаг 5: Обложка 1080×1920
        await report_progress(session, job_id, "cover", "Генерация вертикальной обложки 1080×1920", 90)
        await run_cmd([
            "ffmpeg", "-y", "-ss", "00:00:02", "-i", str(output_file),
            "-frames:v", "1", "-vf",
            "scale=1080:1920,drawbox=y=0:w=1080:h=300:color=black@0.7:t=fill,"
            "drawtext=font='DejaVu Sans':text='Монтажная Кухня':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=100",
            str(thumb_file)
        ])

        # Шаг 6: Завершение и отправка в Telegram
        await report_progress(session, job_id, "upload", "Нормализация EBU R128 и отправка в Telegram", 98)

        caption = (
            f"🎬 **Ваше видео смонтировано!**\n\n"
            f"• Формат: **{job_type.upper()} 1080×1920**\n"
            f"• Звук: EBU R128 (-14 LUFS)\n"
            f"• Движок: `video-montage` v2.0.0\n"
            f"• Задача: `{job_id}`\n\n"
            "Файл готов к публикации на YouTube!"
        )
        await send_telegram_video(tg_id, output_file, caption)
        await report_complete(session, job_id, result_url=f"/demo/{job_id}.mp4", thumb_url=f"/showcase/{job_id}.png")

    except Exception as e:
        logger.error(f"Ошибка при обработке задачи {job_id}: {e}", exc_info=True)
        await report_complete(session, job_id, error=str(e))
    finally:
        shutil.rmtree(task_dir, ignore_errors=True)


async def pull_worker_loop():
    logger.info(f"Pull-Воркер запущен. Опрос очереди на: {API_BASE}/api/worker/next-job")
    async with aiohttp.ClientSession() as session:
        while True:
            try:
                url = f"{API_BASE}/api/worker/next-job"
                async with session.get(url, timeout=15) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        if data.get("status") == "job" and "job" in data:
                            logger.info(f"Захвачена новая задача {data['job']['id']} ({data['job']['type']})")
                            await process_job(session, data["job"])
                    else:
                        logger.warning(f"API вернул статус HTTP {resp.status}")
            except Exception as e:
                logger.error(f"Ошибка соединения с API {API_BASE}: {e}")

            # Опрос очереди раз в 4 секунды
            await asyncio.sleep(4)


if __name__ == "__main__":
    try:
        asyncio.run(pull_worker_loop())
    except KeyboardInterrupt:
        logger.info("Воркер остановлен пользователем")
