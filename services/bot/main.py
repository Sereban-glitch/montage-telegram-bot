"""
Telegram-бот «Монтажная Кухня» (Montage Kitchen Bot)
Стек: Python 3.11+, aiogram 3, aiosqlite.
Взаимодействие с базой данных Prisma SQLite и WebApp (Mini App).
"""

import asyncio
import json
import logging
import os
import sys
import uuid
from datetime import datetime
from pathlib import Path

import aiosqlite
from aiogram import Bot, Dispatcher, F, types
from aiogram.filters import Command, CommandStart
from aiogram.types import (
    FSInputFile,
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    MenuButtonWebApp,
    WebAppInfo,
)
from dotenv import load_dotenv

# Загрузка переменных окружения
load_dotenv()
load_dotenv(Path(__file__).resolve().parent.parent.parent / ".env")

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
WEBAPP_URL = os.getenv("WEBAPP_URL", "http://localhost:3000")
DB_PATH = os.getenv("DATABASE_PATH", str(Path(__file__).resolve().parent.parent.parent / "db" / "custom.db"))
MEDIA_DIR = Path(os.getenv("MEDIA_DIR", str(Path(__file__).resolve().parent.parent.parent / "media")))
PUBLIC_DIR = Path(__file__).resolve().parent.parent.parent / "public"

MEDIA_DIR.mkdir(parents=True, exist_ok=True)
(MEDIA_DIR / "uploads").mkdir(parents=True, exist_ok=True)
(MEDIA_DIR / "renders").mkdir(parents=True, exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("montage-bot")

dp = Dispatcher()


# --- Хелперы базы данных ----------------------------------------------------

async def get_or_create_user(db: aiosqlite.Connection, tg_user: types.User) -> dict:
    tg_id = str(tg_user.id)
    async with db.execute(
        "SELECT id, telegramId, username, firstName, role, dailyUsed, dailyLimit, isBlocked FROM User WHERE telegramId = ?",
        (tg_id,),
    ) as cur:
        row = await cur.fetchone()
        if row:
            return {
                "id": row[0],
                "telegramId": row[1],
                "username": row[2],
                "firstName": row[3],
                "role": row[4],
                "dailyUsed": row[5],
                "dailyLimit": row[6],
                "isBlocked": bool(row[7]),
            }

    # Создаём нового пользователя
    user_id = "u_" + uuid.uuid4().hex[:12]
    now = datetime.utcnow().isoformat()
    await db.execute(
        """
        INSERT INTO User (id, telegramId, username, firstName, role, isBlocked, dailyUsed, dailyLimit, usageResetAt, createdAt)
        VALUES (?, ?, ?, ?, 'user', 0, 0, 3, ?, ?)
        """,
        (user_id, tg_id, tg_user.username, tg_user.first_name, now, now),
    )
    await db.commit()
    return {
        "id": user_id,
        "telegramId": tg_id,
        "username": tg_user.username,
        "firstName": tg_user.first_name,
        "role": "user",
        "dailyUsed": 0,
        "dailyLimit": 3,
        "isBlocked": False,
    }


async def create_job(
    db: aiosqlite.Connection,
    user_id: str,
    job_type: str,
    source_type: str,
    source_name: str | None,
    source_url: str | None,
    file_path: str | None,
    params: dict,
) -> str:
    job_id = "job_" + uuid.uuid4().hex[:12]
    now = datetime.utcnow().isoformat()

    # Считаем текущую длину очереди
    async with db.execute("SELECT COUNT(*) FROM Job WHERE status = 'queued'") as cur:
        q_pos = (await cur.fetchone())[0] + 1

    await db.execute(
        """
        INSERT INTO Job (
            id, userId, type, status, stageKey, stageLabel, progress, queuePosition,
            sourceType, sourceName, sourceUrl, filePath, params, notified, createdAt
        )
        VALUES (?, ?, ?, 'queued', 'download', 'В очереди', 0, ?, ?, ?, ?, ?, ?, 0, ?)
        """,
        (
            job_id,
            user_id,
            job_type,
            q_pos,
            source_type,
            source_name,
            source_url,
            file_path,
            json.dumps(params, ensure_ascii=False),
            now,
        ),
    )

    # Логируем событие
    event_id = "ev_" + uuid.uuid4().hex[:12]
    await db.execute(
        "INSERT INTO Event (id, jobId, level, message, createdAt) VALUES (?, ?, 'info', ?, ?)",
        (event_id, job_id, f"Бот: новая задача {job_type.upper()} поставлена в очередь (позиция #{q_pos})", now),
    )
    await db.commit()
    return job_id


# --- Клавиатуры -------------------------------------------------------------

def main_menu_keyboard() -> InlineKeyboardMarkup:
    buttons = []
    if WEBAPP_URL.startswith("https://"):
        buttons.append([
            InlineKeyboardButton(
                text="🎬 Открыть Монтажную Кухню (Mini App)",
                web_app=WebAppInfo(url=WEBAPP_URL),
            )
        ])
    else:
        buttons.append([
            InlineKeyboardButton(
                text="🎬 Монтажная Кухня (локальный режим)",
                callback_data="webapp_local_info",
            )
        ])

    buttons.extend([
        [
            InlineKeyboardButton(text="📊 Мои задачи и статус", callback_data="my_tasks"),
            InlineKeyboardButton(text="🌟 Витрина готовых работ", callback_data="showcase"),
        ],
        [
            InlineKeyboardButton(text="ℹ️ Помощь и форматы", callback_data="help_info"),
        ],
    ])
    return InlineKeyboardMarkup(inline_keyboard=buttons)


# --- Команды бота -----------------------------------------------------------

@dp.message(CommandStart())
async def cmd_start(message: types.Message):
    async with aiosqlite.connect(DB_PATH) as db:
        user = await get_or_create_user(db, message.from_user)

    text = (
        f"👋 Привет, {message.from_user.first_name}!\n\n"
        "Добро пожаловать в **Монтажную Кухню** — автоматизированный сервис "
        "монтажа Shorts и длинных видео на базе движка `video-montage` v2.0.0.\n\n"
        "✨ **Что умеет сервис:**\n"
        "• **Shorts 1080×1920**: автонарезка динамики, автосубтитры DejaVu Sans на подложке, "
        "двуязычный режим (укр речь + рус субтитры), генерация вертикальной обложки.\n"
        "• **Long 1280×720**: транскрипция Whisper, аудит и вырезка неловких пауз, "
        "главы и обложка.\n"
        "• **YouTube публикация**: загрузка на канал в статус `private`.\n\n"
        f"🎯 Ваш лимит на сегодня: **{user['dailyUsed']}/{user['dailyLimit']} задач**.\n\n"
        "Вы можете прислать видео или ссылку прямо в этот чат или открыть удобное Mini App:"
    )
    await message.answer(text, reply_markup=main_menu_keyboard(), parse_mode="Markdown")


@dp.message(Command("help"))
async def cmd_help(message: types.Message):
    text = (
        "📖 **Инструкция по использованию:**\n\n"
        "1. **Через Mini App (рекомендуется):**\n"
        "   Нажмите кнопку «Открыть Монтажную Кухню» внизу или в меню.\n"
        "   Там доступен интерактивный выбор кадра обложки, настройка субтитров и титулов.\n\n"
        "2. **Прямо через чат бота:**\n"
        "   • Отправьте видеофайл (до 2 ГБ).\n"
        "   • Или отправьте ссылку на YouTube/видео.\n"
        "   • Бот уточнит параметры и добавит задачу в FIFO-очередь.\n\n"
        "⚡ Рендеринг выполняется последовательно (FIFO) для защиты 12 ГБ памяти сервера."
    )
    await message.answer(text, parse_mode="Markdown")


@dp.message(Command("queue"))
async def cmd_queue(message: types.Message):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM Job WHERE status = 'queued'"
        ) as cur:
            queued_cnt = (await cur.fetchone())[0]

        async with db.execute(
            "SELECT id, type, progress, stageLabel FROM Job WHERE status = 'processing' LIMIT 1"
        ) as cur:
            current = await cur.fetchone()

    status_line = (
        f"⚙️ Сейчас рендерится: `{current[1].upper()}` ({current[2]}% — {current[3]})\n"
        if current
        else "🟢 Слот рендера свободен\n"
    )
    text = (
        "📊 **Состояние очереди рендеринга:**\n\n"
        f"{status_line}"
        f"⏳ Ожидают в очереди (FIFO): **{queued_cnt}** задач\n"
        "🛡️ Защита памяти: 1 одновременный рендер (12 ГБ ОЗУ бюджет)."
    )
    await message.answer(text, parse_mode="Markdown")


# --- Обработка входящего видео / документа -----------------------------------

@dp.message(F.video | F.document)
async def handle_video_upload(message: types.Message, bot: Bot):
    video = message.video or message.document
    mime = getattr(video, "mime_type", "") or ""

    if message.document and not (mime.startswith("video/") or video.file_name.lower().endswith((".mp4", ".mov", ".mkv", ".webm"))):
        await message.answer("⚠️ Пожалуйста, отправьте видеофайл (MP4, MOV, MKV, WebM).")
        return

    file_name = getattr(video, "file_name", "telegram_video.mp4")
    file_size_mb = round((video.file_size or 0) / (1024 * 1024), 1)

    status_msg = await message.answer(f"📥 Загрузка файла `{file_name}` ({file_size_mb} МБ)...")

    file_info = await bot.get_file(video.file_id)
    save_path = MEDIA_DIR / "uploads" / f"{uuid.uuid4().hex}_{file_name}"
    await bot.download_file(file_info.file_path, destination=save_path)

    # Клавиатура выбора типа монтажа
    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="📱 Смонтировать Shorts (1080×1920)",
                    callback_data=f"setup:short:{save_path.name}",
                )
            ],
            [
                InlineKeyboardButton(
                    text="🖥️ Смонтировать Long (1280×720)",
                    callback_data=f"setup:long:{save_path.name}",
                )
            ],
            [
                InlineKeyboardButton(text="❌ Отмена", callback_data=f"del:{save_path.name}"),
            ],
        ]
    )

    await status_msg.edit_text(
        f"✅ Файл `{file_name}` успешно загружен на сервер!\n\n"
        "Выберите формат монтажа для запуска обработки:",
        reply_markup=kb,
        parse_mode="Markdown",
    )


@dp.callback_query(F.data.startswith("setup:"))
async def on_setup_format(callback: types.CallbackQuery):
    parts = callback.data.split(":")
    job_type = parts[1]  # short | long
    filename = parts[2]
    file_path = str(MEDIA_DIR / "uploads" / filename)

    async with aiosqlite.connect(DB_PATH) as db:
        user = await get_or_create_user(db, callback.from_user)
        if user["dailyUsed"] >= user["dailyLimit"] and user["role"] != "admin":
            await callback.answer(
                "❌ Исчерпан суточный лимит задач. Обратитесь к администратору.",
                show_alert=True,
            )
            return

        default_params = {
            "title": "Монтаж из Telegram",
            "subtitle": "Автонарезка",
            "speech_lang": "uk",
            "sub_lang": "ru",
            "cover_frame": 15,
            "loudnorm": True,
        } if job_type == "short" else {
            "title": "Полное заседание",
            "max_gap": 2.5,
            "whisper_model": "large-v3-turbo",
            "make_chapters": True,
        }

        job_id = await create_job(
            db=db,
            user_id=user["id"],
            job_type=job_type,
            source_type="upload",
            source_name=filename,
            source_url=None,
            file_path=file_path,
            params=default_params,
        )

        # Увеличиваем счётчик
        await db.execute(
            "UPDATE User SET dailyUsed = dailyUsed + 1 WHERE id = ?",
            (user["id"],),
        )
        await db.commit()

        kb_buttons = []
        if WEBAPP_URL.startswith("https://"):
            kb_buttons.append([
                InlineKeyboardButton(
                    text="📱 Открыть статус в Mini App",
                    web_app=WebAppInfo(url=WEBAPP_URL),
                )
            ])
        else:
            kb_buttons.append([
                InlineKeyboardButton(
                    text="📊 Проверить статус задачи",
                    callback_data="my_tasks",
                )
            ])

        await callback.message.edit_text(
            f"🎬 **Задача принята в конвейер!**\n\n"
            f"• Формат: **{job_type.upper()}**\n"
            f"• ID задачи: `{job_id}`\n"
            f"• Статус: **В очереди (FIFO)**\n\n"
            "Воркер уведомит вас о начале рендеринга и пришлёт готовый файл сразу по окончании.",
            reply_markup=InlineKeyboardMarkup(inline_keyboard=kb_buttons),
            parse_mode="Markdown",
        )
        await callback.answer()


# --- Обработка ссылок на YouTube --------------------------------------------

@dp.message(F.text.startswith("http://") | F.text.startswith("https://"))
async def handle_url(message: types.Message):
    url = message.text.strip()
    is_yt = "youtube.com" in url or "youtu.be" in url

    label = "YouTube ролик" if is_yt else "видео по ссылке"
    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="📱 Сделать Shorts (1080×1920)",
                    callback_data=f"urljob:short:{url[:60]}",
                )
            ],
            [
                InlineKeyboardButton(
                    text="🖥️ Сделать Long (1280×720)",
                    callback_data=f"urljob:long:{url[:60]}",
                )
            ],
        ]
    )

    await message.answer(
        f"🔗 Распознана ссылка на **{label}**.\n\n"
        "Выберите формат для скачивания и монтажа:",
        reply_markup=kb,
        parse_mode="Markdown",
    )


async def safe_callback_answer(callback: types.CallbackQuery, text: str | None = None, show_alert: bool = False):
    try:
        await callback.answer(text=text, show_alert=show_alert)
    except Exception:
        pass

@dp.callback_query(F.data == "my_tasks")
async def on_my_tasks(callback: types.CallbackQuery):
    async with aiosqlite.connect(DB_PATH) as db:
        user = await get_or_create_user(db, callback.from_user)
        async with db.execute(
            """
            SELECT id, type, status, stageLabel, progress, resultUrl
            FROM Job
            WHERE userId = ?
            ORDER BY createdAt DESC LIMIT 5
            """,
            (user["id"],),
        ) as cur:
            jobs = await cur.fetchall()

    if not jobs:
        await callback.message.answer("📭 У вас пока нет созданных задач монтажа.\nОтправьте видео или ссылку в чат, чтобы начать!")
    else:
        lines = ["📊 **Ваши последние задачи:**\n"]
        for j in jobs:
            st_icon = "🟢" if j[2] == "completed" else ("⚙️" if j[2] == "processing" else "⏳")
            lines.append(f"{st_icon} **{j[1].upper()}** ({j[4]}%): {j[3] or j[2]}")
        await callback.message.answer("\n".join(lines), parse_mode="Markdown")
    await safe_callback_answer(callback)


@dp.callback_query(F.data == "showcase")
async def on_showcase(callback: types.CallbackQuery):
    text = (
        "🌟 **Витрина готовых работ:**\n\n"
        "1. 📱 **КСУ: правительство не может ограничивать права** (1080×1920)\n"
        "   Двуязычные субтитры укр → рус, нормализация EBU R128\n"
        "2. 📱 **Судебное заседание: отвод судьи** (1080×1920)\n"
        "   Динамичная нарезка, вертикальная обложка с золотой рамкой\n"
        "3. 🖥️ **Полное заседание суда по ст. 114-1** (1280×720)\n"
        "   Вырезка пауз Whisper, таймкоды для описания\n\n"
        "💡 Для интерактивного просмотра видео и обложек откройте Mini App!"
    )
    await callback.message.answer(text, parse_mode="Markdown")
    await safe_callback_answer(callback)


@dp.callback_query(F.data == "help_info")
async def on_help_info(callback: types.CallbackQuery):
    await cmd_help(callback.message)
    await safe_callback_answer(callback)


@dp.callback_query(F.data == "webapp_local_info")
async def on_webapp_local_info(callback: types.CallbackQuery):
    await callback.message.answer(
        "🎬 Веб-интерфейс «Монтажная Кухня» запущен!\n"
        "Для открытия Mini App внутри Telegram подключается защищённый HTTPS-туннель.",
        parse_mode="Markdown",
    )
    await callback.answer()


# --- Фоновый мониторинг завершённых задач ------------------------------------

async def background_job_notifier(bot: Bot):
    """Каждые 3 секунды проверяет БД и отправляет уведомления о завершении."""
    logger.info("Фоновый notifier запущен")
    while True:
        try:
            if not Path(DB_PATH).exists():
                await asyncio.sleep(3)
                continue

            async with aiosqlite.connect(DB_PATH) as db:
                # Ищем задачи, завершённые, но ещё не уведомленные
                async with db.execute(
                    """
                    SELECT j.id, j.userId, j.type, j.status, j.resultUrl, j.thumbUrl, j.error, u.telegramId
                    FROM Job j
                    JOIN User u ON j.userId = u.id
                    WHERE j.status IN ('completed', 'failed') AND j.notified = 0
                    LIMIT 5
                    """
                ) as cur:
                    rows = await cur.fetchall()

                for r in rows:
                    job_id, user_id, j_type, status, res_url, thumb_url, err_msg, tg_id = r
                    try:
                        if status == "completed":
                            caption = (
                                f"🎉 **Ваше видео готово!**\n\n"
                                f"• Тип: **{j_type.upper()}**\n"
                                f"• ID: `{job_id}`\n"
                                f"• Нормализация звука: EBU R128 (-14 LUFS)\n\n"
                                "Файл готов к публикации и скачиванию!"
                            )

                            # Проверяем локальный файл
                            local_file = None
                            if res_url and res_url.startswith("/demo/"):
                                local_file = PUBLIC_DIR / res_url.lstrip("/")
                            elif res_url and Path(res_url).exists():
                                local_file = Path(res_url)

                            if local_file and local_file.exists():
                                await bot.send_video(
                                    chat_id=int(tg_id),
                                    video=FSInputFile(str(local_file)),
                                    caption=caption,
                                    parse_mode="Markdown",
                                )
                            else:
                                await bot.send_message(
                                    chat_id=int(tg_id),
                                    text=f"{caption}\n\n🔗 Ссылка для просмотра: {WEBAPP_URL}{res_url}",
                                    parse_mode="Markdown",
                                )

                        elif status == "failed":
                            await bot.send_message(
                                chat_id=int(tg_id),
                                text=(
                                    f"⚠️ **Ошибка рендеринга задачи `{job_id}`**\n\n"
                                    f"Причина: `{err_msg or 'Внутренняя ошибка воркера'}`\n\n"
                                    "Пожалуйста, проверьте исходный файл или обратитесь к администратору."
                                ),
                                parse_mode="Markdown",
                            )

                        # Отмечаем задачу как уведомлённую
                        await db.execute(
                            "UPDATE Job SET notified = 1 WHERE id = ?",
                            (job_id,),
                        )
                        await db.commit()
                        logger.info(f"Отправлено уведомление пользователю {tg_id} по задаче {job_id}")

                    except Exception as e:
                        logger.error(f"Не удалось отправить уведомление {tg_id}: {e}")

        except Exception as e:
            logger.error(f"Ошибка в цикле notifier: {e}")

        await asyncio.sleep(3)


# --- Точка входа -------------------------------------------------------------

async def main():
    if not BOT_TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN не задан в .env файле!")
        print("Пожалуйста, укажите TELEGRAM_BOT_TOKEN в файле .env")
        sys.exit(1)

    bot = Bot(token=BOT_TOKEN)

    # Настраиваем кнопку меню Mini App в интерфейсе Telegram (только если есть валидный HTTPS)
    if WEBAPP_URL.startswith("https://"):
        try:
            await bot.set_chat_menu_button(
                menu_button=MenuButtonWebApp(
                    text="Монтажная Кухня",
                    web_app=WebAppInfo(url=WEBAPP_URL),
                )
            )
            logger.info(f"Menu Button WebApp установлен на {WEBAPP_URL}")
        except Exception as e:
            logger.warning(f"Не удалось настроить Menu Button: {e}")
    else:
        logger.info(f"WEBAPP_URL не использует HTTPS ({WEBAPP_URL}), Menu Button пропущен")

    # Запускаем фоновый notifier
    asyncio.create_task(background_job_notifier(bot))

    logger.info("Бот запущен и ожидает сообщений...")
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())
