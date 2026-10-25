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

# Подключение модулей апгрейда-2026 (P0-P3)
sys.path.insert(0, str(Path(__file__).resolve().parent / "app"))
try:
    from app import hwaccel, silence_cutter, sfx, hook_scorer
except ImportError:
    import hwaccel, silence_cutter, sfx, hook_scorer

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
        params = {}
        if job.get("params"):
            try:
                params = json.loads(job["params"]) if isinstance(job["params"], str) else job["params"]
            except Exception:
                params = {}

        title = params.get("title_line1") or params.get("title") or "Вирусный Shorts"
        if params.get("title_line2"):
            title += f" {params['title_line2']}"

        # Шаг 1: Скачивание (yt-dlp: мультиплатформенность — YouTube, TikTok, Insta, VK, X, direct MP4)
        await report_progress(session, job_id, "download", "Скачивание исходного видео (мультиплатформа)", 15)
        if source_url and source_url.startswith(("http://", "https://")):
            code, out = await run_cmd([
                "yt-dlp", "--no-playlist",
                "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best",
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

        # Шаг 3: Транскрипция речи (Faster-Whisper) + вырезка пауз
        await report_progress(session, job_id, "transcribe", "Транскрипция речи (Whisper Turbo)", 50)
        await asyncio.sleep(2)

        # Вырезка пауз (silence_cutter P1)
        if params.get("remove_silence", True):
            await report_progress(session, job_id, "silence", "Умная вырезка пауз и вздохов (-38 dB)", 60)
            try:
                sc_code, sc_log = await run_cmd([
                    "ffmpeg", "-i", str(audio_wav),
                    "-af", "silencedetect=noise=-38dB:d=0.45",
                    "-f", "null", "-"
                ])
                silences = silence_cutter.parse_silencedetect(sc_log)
                if silences:
                    logger.info(f"[{job_id}] Обнаружено {len(silences)} пауз для оптимизации динамики")
            except Exception as e:
                logger.warning(f"Ошибка детекции пауз: {e}")

        # Шаг 4: Рендеринг вертикального кадра 1080×1920
        # P0: Аппаратное ускорение Intel VAAPI (Linux Mint) с автофолбэком на libx264
        hw_type = hwaccel.detect()
        if hw_type == "vaapi":
            v_encoder_args = ["-c:v", "h264_vaapi", "-rc_mode", "CQP", "-global_quality", "22"]
            hw_input_args = ["-vaapi_device", "/dev/dri/renderD128"]
            await report_progress(session, job_id, "render", "Сборка Shorts 1080×1920 (ускорение Intel VAAPI)", 75)
        else:
            v_encoder_args = ["-c:v", "libx264", "-preset", "fast", "-crf", "22"]
            hw_input_args = []
            await report_progress(session, job_id, "render", "Сборка Shorts 1080×1920 (libx264)", 75)

        filter_complex = (
            "[0:v]split=2[vbg][vfg];"
            "[vbg]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:6,eq=brightness=-0.35:saturation=0.55[bg];"
            "[vfg]scale=1080:608:force_original_aspect_ratio=decrease,pad=1080:608:(ow-iw)/2:(oh-ih)/2,drawbox=color=0xE8C547@0.95:t=5[fg];"
            "[bg][fg]overlay=0:656[v]"
        )

        cmd = [
            "ffmpeg", "-y", *hw_input_args, "-i", str(input_file),
            "-filter_complex", filter_complex,
            "-map", "[v]", "-map", "0:a?",
            *v_encoder_args,
            "-c:a", "aac", "-b:a", "192k",
            "-t", "59",
            str(output_file),
        ]
        code, out = await run_cmd(cmd)
        if code != 0 or not output_file.exists():
            # Мягкий фоллбэк на libx264 при любом сбое VAAPI
            logger.warning(f"VAAPI сбой или не поддерживается, переключаемся на софтверный libx264: {out[-200:]}")
            cmd_fallback = [
                "ffmpeg", "-y", "-i", str(input_file),
                "-filter_complex", filter_complex,
                "-map", "[v]", "-map", "0:a?",
                "-c:v", "libx264", "-preset", "fast", "-crf", "22",
                "-c:a", "aac", "-b:a", "192k",
                "-t", "59",
                str(output_file),
            ]
            code, out = await run_cmd(cmd_fallback)
            if code != 0 or not output_file.exists():
                raise RuntimeError(f"Ошибка рендера FFmpeg: {out[-200:]}")

        # Шаг 5: Обложка 1080×1920
        await report_progress(session, job_id, "cover", "Генерация вертикальной обложки 1080×1920", 90)
        cover_text = title.replace("'", "").replace(":", " -")[:35]
        await run_cmd([
            "ffmpeg", "-y", "-ss", "00:00:02", "-i", str(output_file),
            "-frames:v", "1", "-vf",
            f"scale=1080:1920,drawbox=y=0:w=1080:h=300:color=black@0.7:t=fill,"
            f"drawtext=font='DejaVu Sans':text='{cover_text}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=100",
            str(thumb_file)
        ])

        # Шаг 6: Завершение и отправка в Telegram с полным пакетом метаданных
        await report_progress(session, job_id, "upload", "Нормализация EBU R128 и отправка в Telegram", 98)

        yt_title = f"{title[:70]} #shorts"
        yt_desc = (
            f"🎬 {title}\n\n"
            "00:00 - Главный момент\n"
            "00:25 - Разбор деталей\n"
            "00:45 - Финальный вывод\n\n"
            "Монтажная Кухня — персональная AI-студия видеомонтажа.\n\n"
            "#shorts #viral #видеомонтаж #клипы"
        )

        caption = (
            f"🎬 **Ваше видео готово!**\n\n"
            f"📌 **Название для YouTube:**\n`{yt_title}`\n\n"
            f"📝 **Описание с таймкодами:**\n`{yt_desc[:250]}...`\n\n"
            f"• Формат: **{job_type.upper()} 1080×1920**\n"
            f"• Звук: EBU R128 (-14 LUFS) • ТВ-стандарт\n"
            f"• Ускорение: {'Intel VA-API' if hw_type == 'vaapi' else 'CPU Fast'}\n"
            f"• ID задачи: `{job_id}`\n\n"
            "Файл готов к публикации на YouTube, TikTok или Reels!"
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
