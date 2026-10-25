"""Доставка результатов: воркер → Telegram (напрямую) или через бота-нотификатора.

Два пути, один интерфейс:
  - Прод (pull-воркер на ноутбуке): у воркера есть MONTAGE_TG_BOT_TOKEN → шлёт сам
    (меню хуков, карточки модерации, готовые ролики). Inline-кнопки всё равно
    обрабатывает БОТ (он владеет polling'ом callback_query) через API.
  - Каноничный compose-контур: воркер лишь помечает job.notified=False → бот
    забирает /api/bot/notifications и доставляет (не меняем прежнее поведение).

Inline-клавиатуры сериализуются как список рядов кнопок
[{"text": ..., "callback_data"|"url": ...}, ...] — одинаковый формат понимают
Telegram Direct (worker) и бот (keyboards.py).
"""
from __future__ import annotations

import json
from pathlib import Path

import httpx

TG_API = "https://api.telegram.org"


def build_inline(rows: list[list[dict]]) -> dict:
    return {"inline_keyboard": rows}


# ----------------------------------------------------------------
# Форматтеры сообщений
# ----------------------------------------------------------------

def hook_menu_text(source_name: str, candidates: list[dict]) -> str:
    medals = {1: "🥇", 2: "🥈", 3: "🥉"}
    lines = [
        f"🔎 <b>AI Hook Finder</b> нашёл {len(candidates)} вирусных фрагментов "
        f"в «{source_name}»:\n",
    ]
    for c in candidates:
        medal = medals.get(c.get("rank"), "🎬")
        tc = _timecode(c.get("startSec", c.get("start", 0)))
        dur = int(c.get("durationSec", c.get("duration", 0)))
        lines.append(
            f"{medal} <b>#{c.get('rank')} · {tc} · {dur} c · Virality {c.get('score')}%</b>\n"
            f"📌 {c.get('title')}\n"
            f"💬 «{c.get('quote')}»\n"
        )
    lines.append("Выбирайте — воркер сразу поставит монтаж в очередь (ваш приоритет — высший).")
    return "\n".join(lines)


def hook_menu_keyboard(job_id: str, candidates: list[dict]) -> dict:
    rows: list[list[dict]] = []
    for c in candidates:
        rank = c.get("rank")
        rows.append([{"text": f"🎬 Смонтировать Shorts #{rank} ({c.get('score')}%)",
                      "callback_data": f"hook:{job_id}:{rank}"}])
    rows.append([{"text": f"⚡ Смонтировать все {len(candidates)} сразу",
                  "callback_data": f"hookall:{job_id}"}])
    return build_inline(rows)


def approval_text(job_params: dict, metadata: dict, duration_sec: float = 0.0) -> str:
    tags = " ".join(f"#{t.replace(' ', '')}" for t in metadata.get("tags", [])[:8])
    return (
        "📰 <b>News Short из судебной практики (domdara.org)</b>\n\n"
        f"<b>{metadata.get('title')}</b>\n"
        + (f"⏱ Длительность: {int(duration_sec)} c\n" if duration_sec else "")
        + f"\n<b>Хук:</b> {job_params.get('hook', '')}\n"
        f"<b>Вывод:</b> {job_params.get('conclusion', '')[:220]}\n\n"
        f"<b>Теги:</b> {tags}\n\n"
        "⚠️ Ролик <b>не публикуется сам</b>. Одобрите — уйдёт на YouTube в статусе "
        "<b>private</b>, откроете в студии когда будете готовы."
    )


APPROVAL_KEYBOARD = build_inline([
    [{"text": "✅ Одобрить и выгрузить в YouTube (private)", "callback_data": "approve:{job_id}"}],
    [{"text": "✏️ Перегенерировать", "callback_data": "regen:{job_id}"}],
    [{"text": "❌ Отклонить", "callback_data": "reject:{job_id}"}],
])


def approval_keyboard(job_id: str) -> dict:
    return build_inline([
        [{"text": "✅ Одобрить и выгрузить в YouTube (private)", "callback_data": f"approve:{job_id}"}],
        [{"text": "✏️ Перегенерировать", "callback_data": f"regen:{job_id}"}],
        [{"text": "❌ Отклонить", "callback_data": f"reject:{job_id}"}],
    ])


def _timecode(sec: float) -> str:
    sec = int(sec)
    return f"{sec // 3600}:{sec % 3600 // 60:02d}:{sec % 60:02d}" if sec >= 3600 else f"{sec // 60}:{sec % 60:02d}"


# ----------------------------------------------------------------
# Прямая доставка воркером (прод: pull-воркер + MONTAGE_TG_BOT_TOKEN)
# ----------------------------------------------------------------

class TelegramDirect:
    """Мини-клиент Bot API для воркера (sendMessage/sendVideo, ≤49 МБ multipart)."""

    def __init__(self, token: str) -> None:
        self._base = f"{TG_API}/bot{token}"
        self._http = httpx.Client(timeout=300)

    def send_message(self, chat_id: str | int, text: str, inline: dict | None = None) -> bool:
        payload = {"chat_id": chat_id, "text": text, "parse_mode": "HTML",
                   "disable_web_page_preview": True}
        if inline:
            payload["reply_markup"] = json.dumps(inline, ensure_ascii=False)
        r = self._http.post(f"{self._base}/sendMessage", json=payload)
        return r.status_code == 200

    def send_video(self, chat_id: str | int, path: Path, caption: str = "",
                   inline: dict | None = None) -> bool:
        data = {"chat_id": str(chat_id), "caption": caption[:1024], "parse_mode": "HTML"}
        if inline:
            data["reply_markup"] = json.dumps(inline, ensure_ascii=False)
        with open(path, "rb") as f:
            r = self._http.post(f"{self._base}/sendVideo", data=data, files={"video": f})
        return r.status_code == 200


# ----------------------------------------------------------------
# Единая точка доставки из воркера
# ----------------------------------------------------------------

class Notifier:
    """Если задан MONTAGE_TG_BOT_TOKEN — шлёт напрямую; иначе mark-notified (бот подберёт)."""

    def __init__(self, token: str = "") -> None:
        self.direct = TelegramDirect(token) if token else None

    @property
    def available(self) -> bool:
        return self.direct is not None

    def notify(self, chat_id: str | int, text: str, inline: dict | None = None) -> bool:
        if not self.direct:
            return False  # канонический путь: бот-нотификатор доставит по notified=False
        return self.direct.send_message(chat_id, text, inline)

    def notify_video(self, chat_id: str | int, path: Path, caption: str = "",
                     inline: dict | None = None) -> bool:
        if not self.direct:
            return False
        return self.direct.send_video(chat_id, path, caption, inline)
