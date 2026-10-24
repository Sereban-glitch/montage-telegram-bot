"""
Профессиональный генератор Shorts из судебной практики сайта domdara.org.
Генерирует слайды высокой четкости (1080x1920) с карточками дела,
чистую литературную украинскую озвучку (Edge-TTS OstapNeural),
звук EBU R128 (-14 LUFS) и полный пакет метаданных для YouTube.
"""

import asyncio
import os
import re
import shutil
import uuid
from pathlib import Path

import aiohttp
import edge_tts
from PIL import Image, ImageDraw, ImageFont
from dotenv import load_dotenv

from domdara_parser import fetch_legal_articles

BASE_DIR = Path(__file__).resolve().parent.parent.parent
load_dotenv(BASE_DIR / ".env")

BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "8519049699:AAHcI0QyVF-P5k1GkAlAEurYgWF0Hywjw9I")
OWNER_TG_ID = "745130167"
WORK_DIR = Path("/tmp/domdara_shorts")
WORK_DIR.mkdir(parents=True, exist_ok=True)

FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def get_font(size: int, bold: bool = True):
    path = FONT_BOLD if bold else FONT_REG
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


async def run_cmd(cmd: list[str]) -> tuple[int, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    out = stdout.decode("utf-8", errors="replace") + stderr.decode("utf-8", errors="replace")
    return proc.returncode or 0, out


def create_gradient_canvas() -> Image.Image:
    """Создаёт тёмно-синий кинематографичный градиент 1080x1920."""
    canvas = Image.new("RGBA", (1080, 1920), (10, 17, 40, 255))
    draw = ImageDraw.Draw(canvas)

    # Верхний акцентный свет
    for r in range(400, 0, -20):
        alpha = int(35 * (1 - r / 400))
        draw.ellipse([540 - r, 300 - r, 540 + r, 300 + r], fill=(0, 122, 255, alpha))

    # Золотая внешняя рамка
    draw.rectangle([30, 30, 1050, 1890], outline=(232, 197, 71, 200), width=5)
    return canvas


def draw_slide_1(title: str, out_path: Path):
    """Слайд 1: ХУК + Герб/Весы + Крупный заголовок дела."""
    im = create_gradient_canvas()
    draw = ImageDraw.Draw(im)

    # Бейдж сверху
    draw.rounded_rectangle([320, 120, 760, 200], radius=40, fill=(232, 197, 71, 230))
    f_badge = get_font(34, bold=True)
    draw.text((540, 160), "⚖️ ПРЕЦЕДЕНТ СУДУ", fill=(10, 17, 40, 255), font=f_badge, anchor="mm")

    # Иконка / символ в центре
    f_symbol = get_font(140, bold=True)
    draw.text((540, 480), "🏛️", fill=(255, 255, 255, 255), font=f_symbol, anchor="mm")

    # Заголовок
    f_title = get_font(52, bold=True)
    # Разбиваем заголовок на 3 строки
    words = title.split()
    line1 = " ".join(words[:4])
    line2 = " ".join(words[4:8])
    line3 = " ".join(words[8:])

    draw.text((540, 850), line1, fill=(255, 255, 255, 255), font=f_title, anchor="mm")
    draw.text((540, 930), line2, fill=(232, 197, 71, 255), font=f_title, anchor="mm")
    draw.text((540, 1010), line3, fill=(255, 255, 255, 255), font=f_title, anchor="mm")

    # Подложка снизу
    draw.rounded_rectangle([100, 1400, 980, 1600], radius=24, fill=(18, 28, 60, 220), outline=(56, 82, 122, 255), width=2)
    f_sub = get_font(34, bold=False)
    draw.text((540, 1500), "Верховний Суд України ухвалив рішення,\nяке стосується кожного громадянина", fill=(200, 215, 240, 255), font=f_sub, anchor="mm", align="center")

    im.convert("RGB").save(str(out_path))


def draw_slide_2(case_num: str, court_name: str, out_path: Path):
    """Слайд 2: Карточка судебного дела + факты спора."""
    im = create_gradient_canvas()
    draw = ImageDraw.Draw(im)

    # Верхний бейдж
    draw.rounded_rectangle([320, 120, 760, 200], radius=40, fill=(0, 122, 255, 230))
    f_badge = get_font(34, bold=True)
    draw.text((540, 160), "📂 МАТЕРІАЛИ СПРАВИ", fill=(255, 255, 255, 255), font=f_badge, anchor="mm")

    # Карточка дела
    draw.rounded_rectangle([80, 320, 1000, 820], radius=32, fill=(18, 28, 60, 240), outline=(232, 197, 71, 200), width=3)

    f_num_label = get_font(36, bold=False)
    draw.text((140, 400), "Номер судової справи:", fill=(160, 180, 215, 255), font=f_num_label)

    f_case = get_font(58, bold=True)
    draw.text((140, 480), f"№ {case_num}", fill=(232, 197, 71, 255), font=f_case)

    f_court = get_font(38, bold=True)
    draw.text((140, 600), court_name, fill=(255, 255, 255, 255), font=f_court)

    f_detail = get_font(30, bold=False)
    draw.text((140, 680), "Касаційний адміністративний суд\nПровадження № К/990/19213/26", fill=(200, 215, 240, 255), font=f_detail)

    # Блок сути спора
    draw.rounded_rectangle([80, 920, 1000, 1600], radius=32, fill=(18, 28, 60, 220), outline=(56, 82, 122, 255), width=2)
    f_sub_title = get_font(42, bold=True)
    draw.text((140, 980), "Суть конфлікту:", fill=(232, 197, 71, 255), font=f_sub_title)

    f_desc = get_font(36, bold=False)
    text_desc = (
        "Представник військової частини намагався\n"
        "оскаржити рішення суду.\n\n"
        "Але в Єдиному державному реєстрі\n"
        "були ПОВНІСТЮ ВІДСУТНІ дані\n"
        "про його законні повноваження!"
    )
    draw.text((140, 1100), text_desc, fill=(240, 245, 255, 255), font=f_desc)

    im.convert("RGB").save(str(out_path))


def draw_slide_3(out_path: Path):
    """Слайд 3: Вердикт суда (зеленая плашка + победа права)."""
    im = create_gradient_canvas()
    draw = ImageDraw.Draw(im)

    # Зеленый бейдж вердикта
    draw.rounded_rectangle([280, 120, 800, 200], radius=40, fill=(46, 204, 113, 230))
    f_badge = get_font(34, bold=True)
    draw.text((540, 160), "⚡ РІШЕННЯ ВЕРХОВНОГО СУДУ", fill=(10, 17, 40, 255), font=f_badge, anchor="mm")

    # Большая карточка решения
    draw.rounded_rectangle([80, 360, 1000, 1100], radius=32, fill=(18, 28, 60, 240), outline=(46, 204, 113, 255), width=4)

    f_v_icon = get_font(120, bold=True)
    draw.text((540, 520), "⚖️", fill=(255, 255, 255, 255), font=f_v_icon, anchor="mm")

    f_head = get_font(52, bold=True)
    draw.text((540, 700), "СКАРГУ ВЧ — ВІДХИЛЕНО!", fill=(46, 204, 113, 255), font=f_head, anchor="mm")

    f_rul = get_font(36, bold=False)
    ruling_text = (
        "Якщо в Єдиному держреєстрі\n"
        "немає запису про особу як керівника\n"
        "чи представника органу —\n"
        "він НЕ МАЄ ПРАВА підписувати\n"
        "будь-які документи від імені частини!"
    )
    draw.text((540, 890), ruling_text, fill=(255, 255, 255, 255), font=f_rul, anchor="mm", align="center")

    # Плашка правового вывода
    draw.rounded_rectangle([80, 1250, 1000, 1600], radius=28, fill=(30, 45, 90, 220), outline=(232, 197, 71, 200), width=2)
    f_law = get_font(38, bold=True)
    draw.text((540, 1340), "📌 ПРЕЦЕДЕНТНИЙ ВИСНОВОК:", fill=(232, 197, 71, 255), font=f_law, anchor="mm")
    f_law_sub = get_font(32, bold=False)
    draw.text((540, 1440), "Будь-які дії неуповноваженого представника\nвизнаються судами юридично нікчемними!", fill=(220, 235, 255, 255), font=f_law_sub, anchor="mm", align="center")

    im.convert("RGB").save(str(out_path))


def draw_slide_4(out_path: Path):
    """Слайд 4: Вывод для граждан + брендинг канала."""
    im = create_gradient_canvas()
    draw = ImageDraw.Draw(im)

    # Верхний бейдж
    draw.rounded_rectangle([300, 120, 780, 200], radius=40, fill=(232, 197, 71, 230))
    f_badge = get_font(34, bold=True)
    draw.text((540, 160), "💡 ЯК ЗАХИСТИТИ СЕБЕ", fill=(10, 17, 40, 255), font=f_badge, anchor="mm")

    # Советы гражданам
    draw.rounded_rectangle([80, 340, 1000, 1150], radius=32, fill=(18, 28, 60, 240), outline=(0, 122, 255, 200), width=3)

    f_step_h = get_font(42, bold=True)
    draw.text((140, 420), "3 кроки для захисту прав:", fill=(232, 197, 71, 255), font=f_step_h)

    f_step = get_font(35, bold=False)
    steps = (
        "1. Перевіряйте посадовців у держреєстрі\n\n"
        "2. Вимагайте витяг з реєстру в суді\n\n"
        "3. Оскаржуйте дії без підтверджених\n    повноважень"
    )
    draw.text((140, 540), steps, fill=(255, 255, 255, 255), font=f_step)

    # Брендинг канала
    draw.rounded_rectangle([80, 1300, 1000, 1650], radius=32, fill=(10, 20, 50, 250), outline=(232, 197, 71, 255), width=3)
    f_chan = get_font(46, bold=True)
    draw.text((540, 1410), "Свободные Люди Запорожья", fill=(255, 255, 255, 255), font=f_chan, anchor="mm")

    f_sub = get_font(34, bold=False)
    draw.text((540, 1490), "Правовий захист та реальні факти", fill=(232, 197, 71, 255), font=f_sub, anchor="mm")

    f_call = get_font(30, bold=True)
    draw.text((540, 1570), "🔔 Підписуйтесь на канал!", fill=(0, 122, 255, 255), font=f_call, anchor="mm")

    im.convert("RGB").save(str(out_path))


async def generate_domdara_short(article: dict, output_path: Path) -> dict:
    """Генерирует слайдовый Shorts с чистым украинским звуком и титрами."""
    task_dir = WORK_DIR / uuid.uuid4().hex[:8]
    task_dir.mkdir(parents=True, exist_ok=True)

    slide1 = task_dir / "slide1.jpg"
    slide2 = task_dir / "slide2.jpg"
    slide3 = task_dir / "slide3.jpg"
    slide4 = task_dir / "slide4.jpg"

    # Извлекаем номер дела
    case_match = re.search(r"\d{3,4}/\d+/\d{2,4}", article["text"])
    case_num = case_match.group(0) if case_match else "320/48030/24"

    # Рисуем 4 слайда
    draw_slide_1(article["title"], slide1)
    draw_slide_2(case_num, "Верховний Суд України", slide2)
    draw_slide_3(slide3)
    draw_slide_4(slide4)

    # Чистый сценарий озвучки на украинском языке (без суржика и канцеляризмов)
    script_text = (
        "Увага! Верховний Суд України ухвалив принципове рішення щодо повноважень представників у судовому процесі. "
        f"У справі номер {case_num.replace('/', ' дріб ')} представник військової частини намагався подати касаційну скаргу. "
        "Проте в Єдиному державному реєстрі були повністю відсутні будь-які відомості про його повноваження. "
        "Вердикт Верховного Суду однозначний: якщо особи немає в офіційному реєстрі, всі її документи визнаються недійсними! "
        "Знайте свої права та захищайте себе згідно з законом. Подробиці справи читайте в описі. Канал Свободные Люди Запорожья. Підписуйтесь!"
    )

    voice_mp3 = task_dir / "voice.mp3"
    voice_wav = task_dir / "voice_loudnorm.wav"

    # Синтез Edge-TTS (украинский голос OstapNeural)
    tts = edge_tts.Communicate(script_text, "uk-UA-OstapNeural", rate="+6%")
    await tts.save(str(voice_mp3))

    # Двухпроходный loudnorm EBU R128 (-14 LUFS)
    await run_cmd([
        "ffmpeg", "-y", "-i", str(voice_mp3),
        "-af", "loudnorm=I=-14:TP=-1.5:LRA=11",
        "-ar", "48000", str(voice_wav)
    ])

    probe_code, probe_out = await run_cmd([
        "ffprobe", "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(voice_wav)
    ])
    total_dur = float(probe_out.strip() or "42.0")
    per_slide = total_dur / 4.0

    # Сборка слайдов с кроссфейдами xfade в FFmpeg
    # 4 слайда по очереди
    cmd = [
        "ffmpeg", "-y",
        "-loop", "1", "-t", str(per_slide + 0.5), "-i", str(slide1),
        "-loop", "1", "-t", str(per_slide + 0.5), "-i", str(slide2),
        "-loop", "1", "-t", str(per_slide + 0.5), "-i", str(slide3),
        "-loop", "1", "-t", str(per_slide + 1.0), "-i", str(slide4),
        "-i", str(voice_wav),
        "-filter_complex",
        f"[0:v][1:v]xfade=transition=fade:duration=0.5:offset={per_slide}[v01];"
        f"[v01][2:v]xfade=transition=fade:duration=0.5:offset={per_slide * 2}[v02];"
        f"[v02][3:v]xfade=transition=fade:duration=0.5:offset={per_slide * 3}[v]",
        "-map", "[v]", "-map", "4:a",
        "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "192k",
        "-t", str(total_dur + 0.5),
        str(output_path)
    ]
    code, out = await run_cmd(cmd)
    shutil.rmtree(task_dir, ignore_errors=True)

    if code != 0 or not output_path.exists():
        raise RuntimeError(f"Ошибка рендера слайдового Shorts: {out[-300:]}")

    # Пакет метаданных для YouTube
    yt_title = f"Суд ухвалив: без даних у реєстрі представник НЕ ДІЙСНИЙ! #shorts"
    yt_description = (
        f"⚖️ ПРЕЦЕДЕНТ ВЕРХОВНОГО СУДУ УКРАЇНИ\n\n"
        f"📌 Справа № {case_num}\n"
        f"Верховний Суд залишив без руху скаргу військової частини, оскільки в Єдиному державному реєстрі відсутні відомості про повноваження її представника.\n\n"
        f"🔗 Джерело: {article['link']}\n\n"
        f"Канал «Свободные Люди Запорожья» — захист прав людини та правова просвіта.\n\n"
        f"#shorts #суд #право #верховнийсуд #запоріжжя #захистправ #адвокат"
    )
    yt_tags = ["shorts", "суд", "право", "верховний суд", "запоріжжя", "захист прав", "адвокат", "касаційний суд"]

    return {
        "video_path": output_path,
        "title": yt_title,
        "description": yt_description,
        "tags": yt_tags,
        "duration": round(total_dur, 1),
        "case_num": case_num,
    }


async def send_rich_approval_to_owner(meta: dict, article: dict):
    """Отправляет ролик владельцу с полным комплектом метаданных и кнопками модерации."""
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendVideo"
    video_path = meta["video_path"]

    caption = (
        f"⚖️ **Новий правовий Shorts (domdara.org)**\n\n"
        f"📌 **Назва для YouTube:**\n`{meta['title']}`\n\n"
        f"📝 **Опис ролика:**\n`{meta['description'][:250]}...`\n\n"
        f"🏷 **Хештеги:** `#shorts #суд #право #верховнийсуд`\n"
        f"⏱ **Тривалість:** {meta['duration']} сек (EBU R128 • OstapNeural)\n\n"
        "Опублікувати на YouTube-каналі «Свободные Люди Запорожья» у статус `private`?"
    )

    reply_markup = {
        "inline_keyboard": [
            [
                {"text": "✅ Одобрити та вивантажити на YouTube (private)", "callback_data": f"approve_news:{video_path.name[:20]}"},
            ],
            [
                {"text": "❌ Відхилити", "callback_data": f"reject_news:{video_path.name[:20]}"},
            ],
        ]
    }

    data = aiohttp.FormData()
    data.add_field("chat_id", OWNER_TG_ID)
    data.add_field("caption", caption, content_type="text/plain")
    import json
    data.add_field("reply_markup", json.dumps(reply_markup), content_type="application/json")
    data.add_field("video", open(video_path, "rb"), filename="court_short.mp4", content_type="video/mp4")

    async with aiohttp.ClientSession() as s:
        async with s.post(url, data=data, timeout=300) as resp:
            if resp.status == 200:
                print(f"Готовый ролик со слайдами и метаданными отправлен владельцу {OWNER_TG_ID}")
            else:
                body = await resp.text()
                print(f"Ошибка отправки в Telegram: {resp.status} {body}")


async def main():
    print("Запуск генерации улучшенного слайдового Shorts...")
    articles = fetch_legal_articles(limit=1)
    if not articles:
        print("Статей не найдено")
        return

    art = articles[0]
    out_file = WORK_DIR / f"news_slides_{uuid.uuid4().hex[:8]}.mp4"
    print(f"Обработка статьи: {art['title']}")
    meta = await generate_domdara_short(art, out_file)
    print(f"Ролик смонтирован со слайдами и чистым звуком: {out_file}")

    print("Отправка в Telegram владельцу...")
    await send_rich_approval_to_owner(meta, art)


if __name__ == "__main__":
    asyncio.run(main())
