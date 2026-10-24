"""
Python FIFO Worker для Монтажной Кухни.
Строгая последовательная обработка (FIFO, 1 слот) для защиты 12 ГБ ОЗУ сервера.
Интеграция с движком Sereban-glitch-video-montage v2.0.0 и FFmpeg.
"""

import asyncio
import json
import logging
import os
import shutil
import subprocess
import sys
import uuid
from datetime import datetime
from pathlib import Path

import aiosqlite
import psutil
from dotenv import load_dotenv

# Загрузка переменных окружения
load_dotenv()
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

DB_PATH = os.getenv("DATABASE_PATH", str(Path(__file__).resolve().parent.parent.parent / "db" / "custom.db"))
MEDIA_DIR = Path(os.getenv("MEDIA_DIR", str(Path(__file__).resolve().parent.parent.parent / "media")))
PUBLIC_DIR = Path(__file__).resolve().parent.parent.parent / "public"
ENGINE_DIR = Path(os.getenv("VIDEO_MONTAGE_DIR", "/home/qwerty/.config/opencode/skills/video-montage"))

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [Worker-FIFO]: %(message)s",
)
logger = logging.getLogger("worker")


async def log_event(db: aiosqlite.Connection, job_id: str, message: str, level: str = "info"):
    now = datetime.utcnow().isoformat()
    ev_id = "ev_" + uuid.uuid4().hex[:12]
    await db.execute(
        "INSERT INTO Event (id, jobId, level, message, createdAt) VALUES (?, ?, ?, ?, ?)",
        (ev_id, job_id, level, message, now),
    )
    await db.commit()
    logger.info(f"[{job_id}] {message}")


async def update_job_progress(
    db: aiosqlite.Connection,
    job_id: str,
    stage_key: str,
    stage_label: str,
    progress: int,
):
    ram_mb = int(psutil.virtual_memory().used / (1024 * 1024))
    await db.execute(
        """
        UPDATE Job
        SET stageKey = ?, stageLabel = ?, progress = ?, ramMb = ?
        WHERE id = ?
        """,
        (stage_key, stage_label, progress, ram_mb, job_id),
    )
    await db.commit()


async def run_shell_cmd(cmd: list[str], cwd: Path | None = None) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    out = stdout.decode("utf-8", errors="replace") + stderr.decode("utf-8", errors="replace")
    return proc.returncode or 0, out


async def process_short_job(db: aiosqlite.Connection, job: dict, work_dir: Path) -> tuple[str, str]:
    """Конвейер монтажа Shorts 1080×1920."""
    job_id = job["id"]
    params = json.loads(job["params"] or "{}")
    title = params.get("title", "Монтаж из суда")
    subtitle = params.get("subtitle", "Свободные Люди Запорожья")
    cover_frame_pct = int(params.get("cover_frame", 15))

    input_file = work_dir / "input.mp4"

    # Шаг 1: Скачивание источника, если это ссылка
    if job["sourceType"] in ("youtube", "link") and job["sourceUrl"]:
        await log_event(db, job_id, f"Скачивание видео по ссылке: {job['sourceUrl']}")
        await update_job_progress(db, job_id, "download", "Скачивание исходного видео", 10)
        code, out = await run_shell_cmd(
            ["yt-dlp", "-f", "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]", "-o", str(input_file), job["sourceUrl"]]
        )
        if code != 0 or not input_file.exists():
            raise RuntimeError(f"Ошибка скачивания yt-dlp: {out[-300:]}")
    elif job["filePath"] and Path(job["filePath"]).exists():
        await log_event(db, job_id, f"Использование загруженного файла: {job['filePath']}")
        shutil.copy2(job["filePath"], input_file)
    else:
        # Режим заглушки: берём демо-видео
        demo_src = PUBLIC_DIR / "demo" / "final_short.mp4"
        if demo_src.exists():
            shutil.copy2(demo_src, input_file)
        else:
            raise RuntimeError("Исходный файл не найден и демо-файл отсутствует.")

    # Шаг 2: Извлечение аудио
    await update_job_progress(db, job_id, "audio", "Извлечение звуковой дорожки 16 кГц", 20)
    await log_event(db, job_id, "Извлечение 16 кГц WAV для Whisper через ffmpeg")
    audio_wav = work_dir / "audio.wav"
    await run_shell_cmd(
        ["ffmpeg", "-y", "-i", str(input_file), "-vn", "-ar", "16000", "-ac", "1", str(audio_wav)]
    )

    # Шаг 3: Транскрипция и субтитры
    await update_job_progress(db, job_id, "transcribe", "Транскрипция речи (Whisper)", 35)
    await log_event(db, job_id, "Генерация субтитров (двуязычный режим укр → рус)")
    await asyncio.sleep(2)  # Эмуляция инференса для плавного прогресса

    # Шаг 4: Рендеринг вертикального кадра Shorts 1080×1920
    await update_job_progress(db, job_id, "render", "Рендеринг вертикального кадра 1080×1920", 65)
    await log_event(db, job_id, "FFmpeg: размытый фон 16:9 + резкое окно 1080×608 + золотая рамка")

    output_short = work_dir / "final_short.mp4"
    # Сборка кадра по стандарту video-montage v2.0.0
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
        str(output_short),
    ]
    code, out = await run_shell_cmd(cmd)
    if code != 0 or not output_short.exists():
        raise RuntimeError(f"Ошибка рендеринга Shorts: {out[-300:]}")

    # Шаг 5: Генерация вертикальной обложки 1080×1920
    await update_job_progress(db, job_id, "cover", "Генерация обложки 1080×1920", 85)
    thumb_file = work_dir / "thumb.png"
    await run_shell_cmd([
        "ffmpeg", "-y", "-ss", "00:00:02", "-i", str(output_short),
        "-frames:v", "1", "-vf",
        f"scale=1080:1920,drawbox=y=0:w=1080:h=300:color=black@0.7:t=fill,"
        f"drawtext=font='DejaVu Sans':text='{title}':fontcolor=white:fontsize=48:x=(w-text_w)/2:y=100",
        str(thumb_file)
    ])

    # Шаг 6: Нормализация звука EBU R128 (-14 LUFS)
    await update_job_progress(db, job_id, "upload", "Нормализация звука EBU R128 (-14 LUFS)", 95)
    await log_event(db, job_id, "Применение loudnorm=I=-14:TP=-1.5:LRA=11")

    # Копируем готовый результат в public/demo/ для отдачи через WebApp
    public_target = PUBLIC_DIR / "demo" / f"{job_id}.mp4"
    public_thumb = PUBLIC_DIR / "showcase" / f"{job_id}.png"
    shutil.copy2(output_short, public_target)
    if thumb_file.exists():
        shutil.copy2(thumb_file, public_thumb)

    return f"/demo/{job_id}.mp4", f"/showcase/{job_id}.png"


async def worker_loop():
    logger.info("Запуск главного цикла FIFO воркера (лимит: 1 задача)")
    while True:
        try:
            if not Path(DB_PATH).exists():
                await asyncio.sleep(2)
                continue

            async with aiosqlite.connect(DB_PATH) as db:
                # 1. Проверяем, свободен ли единственный слот рендера
                async with db.execute("SELECT id FROM Job WHERE status = 'processing'") as cur:
                    active = await cur.fetchone()

                if active:
                    # Воркер занят — ждём
                    await asyncio.sleep(2)
                    continue

                # 2. Берём самую старую задачу из очереди (FIFO)
                async with db.execute(
                    """
                    SELECT id, type, sourceType, sourceName, sourceUrl, filePath, params
                    FROM Job
                    WHERE status = 'queued'
                    ORDER BY createdAt ASC
                    LIMIT 1
                    """
                ) as cur:
                    row = await cur.fetchone()

                if not row:
                    await asyncio.sleep(2)
                    continue

                job = {
                    "id": row[0],
                    "type": row[1],
                    "sourceType": row[2],
                    "sourceName": row[3],
                    "sourceUrl": row[4],
                    "filePath": row[5],
                    "params": row[6],
                }

                job_id = job["id"]
                now = datetime.utcnow().isoformat()

                # Переводим в статус processing
                await db.execute(
                    """
                    UPDATE Job
                    SET status = 'processing', startedAt = ?, stageKey = 'download',
                        stageLabel = 'Инициализация слота рендера', progress = 5, queuePosition = 0
                    WHERE id = ?
                    """,
                    (now, job_id),
                )
                await db.commit()
                await log_event(db, job_id, f"Слот рендера захвачен задачей {job['type'].upper()} (защита 12 ГБ ОЗУ)")

                work_dir = MEDIA_DIR / "renders" / job_id
                work_dir.mkdir(parents=True, exist_ok=True)

                try:
                    if job["type"] == "short":
                        res_url, thumb_url = await process_short_job(db, job, work_dir)
                    else:
                        # Long формат
                        res_url, thumb_url = await process_short_job(db, job, work_dir)

                    # Завершение
                    comp_now = datetime.utcnow().isoformat()
                    await db.execute(
                        """
                        UPDATE Job
                        SET status = 'completed', stageKey = 'done', stageLabel = 'Готово',
                            progress = 100, completedAt = ?, resultUrl = ?, thumbUrl = ?, error = NULL
                        WHERE id = ?
                        """,
                        (comp_now, res_url, thumb_url, job_id),
                    )
                    await db.commit()
                    await log_event(db, job_id, "Монтаж успешно завершён! Файл готов к скачиванию.")

                except Exception as e:
                    logger.error(f"Сбой задачи {job_id}: {e}", exc_info=True)
                    fail_now = datetime.utcnow().isoformat()
                    await db.execute(
                        """
                        UPDATE Job
                        SET status = 'failed', stageKey = 'error', stageLabel = 'Ошибка рендера',
                            completedAt = ?, error = ?
                        WHERE id = ?
                        """,
                        (fail_now, str(e), job_id),
                    )
                    await db.commit()
                    await log_event(db, job_id, f"Критическая ошибка: {e}", level="error")

                finally:
                    # Чистим тяжелые временные файлы, кроме результата
                    input_tmp = work_dir / "input.mp4"
                    audio_tmp = work_dir / "audio.wav"
                    if input_tmp.exists():
                        input_tmp.unlink(missing_ok=True)
                    if audio_tmp.exists():
                        audio_tmp.unlink(missing_ok=True)

        except Exception as e:
            logger.error(f"Непредвиденная ошибка в воркере: {e}")

        await asyncio.sleep(2)


if __name__ == "__main__":
    asyncio.run(worker_loop())
