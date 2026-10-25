"""Фича №2, слой источника: RSS-парсер domdara.org + фильтр «брака» + дедуп.

WordPress RSS 2.0: http://domdara.org/feed/
  - <item><guid>, <link>, <title>, <pubDate>, <description>, <content:encoded>,
    <category>, <enclosure url=… type="image/…">
Фильтр качества (отсекаем фото-посты и огрызки):
  - очищенного текста < 200 символов → скип;
  - текста нет вовсе, есть только enclosure-картинка → скип;
  - текст состоит в основном из ссылок (> 40 %) → скип;
  - раздел «Право»/судебная практика → приоритет (классификатор по лексикону).
Зависимости: только stdlib (xml.etree, html, re) + httpx для HTTP.

CLI:
  python -m app.domdara_rss --check           # разобрать фид, показать фильтрацию (без БД)
  python -m app.domdara_rss --once            # fetch → дедуп → постановка фоновых задач
  python -m app.domdara_rss --once --limit 3  # не больше 3 новых статей за проход
"""
from __future__ import annotations

import argparse
import html
import json
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from datetime import datetime, timezone

import httpx

DEFAULT_FEED = "http://domdara.org/feed/"
USER_AGENT = "Mozilla/5.0 (compatible; MontageKitchenBot/2.0; +https://montage.kitchen)"
NS = {
    "content": "http://purl.org/rss/1.0/modules/content/",
    "dc": "http://purl.org/dc/elements/1.1/",
}

# Лексикон раздела «Право» / судебной практики
LAW_KEYWORDS = (
    "суд", "судов", "постанова", "рішення", "верховний суд", "касаційн", "апеляц",
    "позов", "позивач", "відповідач", "прецедент", "правосуддя", "правопоруш",
    "адвокат", "юрист", "юрисдикц", "прокуратур", "виправдувальн", "стягненн",
    "штраф", "адмінправопоруш", "кримінальн", "цивільн", "господарськ",
    "захист прав", "права людини", "компенсація", "відшкодуван", "справа №",
)

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"[ \t\u00a0]+")
_NL_RE = re.compile(r"\n{3,}")
_LINK_RE = re.compile(r"https?://\S+")


# ----------------------------------------------------------------
# Модель записи RSS
# ----------------------------------------------------------------

@dataclass
class FeedItem:
    guid: str = ""
    link: str = ""
    title: str = ""
    pub_date: str = ""
    content_html: str = ""
    description_html: str = ""
    categories: list[str] = field(default_factory=list)
    enclosure_url: str = ""

    @property
    def text(self) -> str:
        """Очищенный текст статьи: content:encoded → description, без HTML."""
        raw = self.content_html or self.description_html or ""
        return clean_html(raw)

    @property
    def is_photo_only(self) -> bool:
        return bool(self.enclosure_url) and len(self.text.strip()) < 50


# ----------------------------------------------------------------
# Очистка HTML → текст
# ----------------------------------------------------------------

def clean_html(raw: str) -> str:
    if not raw:
        return ""
    text = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", raw)
    text = re.sub(r"(?i)<br\s*/?>", "\n", text)
    text = re.sub(r"(?i)</(p|div|h[1-6]|li|blockquote)>", "\n", text)
    text = _TAG_RE.sub(" ", text)
    text = html.unescape(text)
    text = _WS_RE.sub(" ", text)
    text = _NL_RE.sub("\n\n", text)
    return text.strip()


def parse_rss(xml_text: str) -> list[FeedItem]:
    """Парсинг RSS 2.0 (WordPress). Устойчив к отсутствию content:encoded."""
    root = ET.fromstring(xml_text.encode("utf-8") if isinstance(xml_text, str) else xml_text)
    items: list[FeedItem] = []
    for node in root.iter("item"):
        it = FeedItem()
        it.guid = (node.findtext("guid") or node.findtext("link") or "").strip()
        it.link = (node.findtext("link") or "").strip()
        it.title = clean_html(node.findtext("title") or "")
        it.pub_date = (node.findtext("pubDate") or "").strip()
        it.content_html = (node.findtext("content:encoded", default="", namespaces=NS) or "")
        it.description_html = (node.findtext("description") or "")
        it.categories = [(c.text or "").strip() for c in node.findall("category") if c.text]
        enc = node.find("enclosure")
        if enc is not None:
            it.enclosure_url = enc.get("url", "")
        items.append(it)
    return items


def parse_pubdate(raw: str) -> datetime | None:
    """RFC-822 pubDate → aware datetime (_best-effort)."""
    if not raw:
        return None
    from email.utils import parsedate_to_datetime

    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt
    except (TypeError, ValueError):
        return None


# ----------------------------------------------------------------
# Фильтр качества
# ----------------------------------------------------------------

@dataclass
class QualityVerdict:
    ok: bool
    reason: str = ""
    law_related: bool = False


def quality_check(item: FeedItem, min_chars: int = 200) -> QualityVerdict:
    """Пропускаем только содержательные судебные решения."""
    text = item.text
    if len(text.strip()) < 50 and item.enclosure_url:
        return QualityVerdict(False, "фото-пост без текста")
    if len(text) < min_chars:
        return QualityVerdict(False, f"текст короче {min_chars} символов ({len(text)})")
    # заметка-«просто ссылка»
    link_share = sum(len(m) for m in _LINK_RE.findall(text)) / max(1, len(text))
    if link_share > 0.4:
        return QualityVerdict(False, "текст состоит в основном из ссылок")
    blob = (item.title + " " + text[:1500]).lower()
    law_related = any(k in blob for k in LAW_KEYWORDS)
    return QualityVerdict(True, "", law_related=law_related)


def is_law_related(item: FeedItem) -> bool:
    return quality_check(item).law_related


# ----------------------------------------------------------------
# HTTP
# ----------------------------------------------------------------

def fetch_feed(url: str = DEFAULT_FEED, timeout: float = 30.0) -> list[FeedItem]:
    r = httpx.get(url, headers={"User-Agent": USER_AGENT}, timeout=timeout, follow_redirects=True)
    r.raise_for_status()
    return parse_rss(r.text)


# ----------------------------------------------------------------
# Интеграция с очередью (дедуп + постановка фоновых задач)
# ----------------------------------------------------------------

def dedup_new_items(session, items: list[FeedItem]) -> tuple[list, list]:
    """Разделяет записи на новые/уже виденные (по NewsArticle.guid)."""
    from backend.app.models import NewsArticle

    new, seen = [], []
    for it in items:
        if not it.guid:
            continue
        exists = session.query(NewsArticle).filter(NewsArticle.guid == it.guid).first()
        (seen if exists else new).append(it)
    return new, seen


def enqueue_news_jobs(session, items: list[FeedItem], daily_max: int = 2,
                      owner_user_id: str = "", today_count: int | None = None) -> list:
    """Создаёт NewsArticle + фоновые Job(type=news_shorts, priority=1).

    Возвращает созданные Job-объекты. Вызывается ТОЛЬКО из idle-такта воркера,
    когда интерактивная очередь пуста (второй слой Zero-Conflict Queue).
    """
    from backend.app.models import Job, NewsArticle, new_id

    if today_count is None:
        start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        today_count = session.query(Job).filter(
            Job.type == "news_shorts", Job.created_at >= start_of_day
        ).count()
    created: list[Job] = []
    for it in items:
        if today_count >= daily_max:
            break
        verdict = quality_check(it)
        article = NewsArticle(
            id=new_id(), guid=it.guid, url=it.link or it.guid, title=it.title or "Без назви",
            snippet=it.text[:400], published_at=parse_pubdate(it.pub_date),
            state="queued" if verdict.ok else "skipped",
        )
        session.add(article)
        if not verdict.ok:
            session.commit()
            continue
        job = Job(
            id=new_id(), user_id=owner_user_id, type="news_shorts", status="queued",
            priority=1, source_type="link", source_name=article.title[:120],
            source_url=article.url,
            params=json.dumps({
                "article_id": article.id, "article_url": article.url,
                "article_title": article.title,
                "article_text": it.text[:12000],  # полный текст для сценария
                "voice": "", "variant": 0,
            }, ensure_ascii=False),
        )
        session.add(job)
        article.job_id = job.id
        created.append(job)
        today_count += 1
    session.commit()
    return created


# ----------------------------------------------------------------
# CLI (проверка без БД / ручной прогон)
# ----------------------------------------------------------------

def main() -> None:
    ap = argparse.ArgumentParser(description="domdara.org RSS → очередь Shorts")
    ap.add_argument("--feed", default=DEFAULT_FEED)
    ap.add_argument("--check", action="store_true", help="разобрать фид и показать вердикты фильтра")
    ap.add_argument("--once", action="store_true", help="fetch → дедуп → постановка задач (нужна БД)")
    ap.add_argument("--limit", type=int, default=2, help="сколько новых статей ставить за проход")
    args = ap.parse_args()

    items = fetch_feed(args.feed)
    print(f"Фид: {args.feed} — записей: {len(items)}")
    for i, it in enumerate(items, 1):
        v = quality_check(it)
        flag = "LAW " if v.law_related else "    "
        print(f"{i:2}. [{flag}] {'OK  ' if v.ok else 'SKIP'} {it.title[:60]!r:64} {v.reason}")
        if args.check:
            continue

    if args.once:
        from .config import get_settings
        from .db import session_factory

        Session = session_factory()
        session = Session()
        from backend.app.models import User

        owner = session.query(User).filter(User.role == "admin").first()
        new_items, seen = dedup_new_items(session, items)
        print(f"Новых: {len(new_items)}, уже виденных: {len(seen)}")
        jobs = enqueue_news_jobs(session, new_items, daily_max=args.limit,
                                 owner_user_id=owner.id if owner else "")
        print(f"Поставлено фоновых задач: {len(jobs)} → {[j.id for j in jobs]}")
        session.close()


if __name__ == "__main__":
    main()
