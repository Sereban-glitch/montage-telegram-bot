"""
Парсер новостей судебной практики с сайта domdara.org.
Фильтрует брак (посты без текста или только с фото).
Извлекает содержательные правовые статьи и постановления судов.
"""

import re
from typing import Optional
from bs4 import BeautifulSoup
import feedparser

FEED_URL = "http://domdara.org/feed/"


def clean_html(raw_html: str) -> str:
    """Очищает HTML-разметку, оставляя чистый читаемый текст."""
    soup = BeautifulSoup(raw_html, "html.parser")
    # Удаляем скрипты и стили
    for s in soup(["script", "style"]):
        s.decompose()
    text = soup.get_text(separator=" ")
    # Убираем множественные пробелы и переносы
    text = re.sub(r"\s+", " ", text).strip()
    return text


def fetch_legal_articles(limit: int = 5) -> list[dict]:
    """
    Загружает RSS-фид domdara.org и отбирает содержательные правовые статьи.
    Пропускает посты, где только картинки или текста меньше 200 символов.
    """
    feed = feedparser.parse(FEED_URL)
    articles = []

    for entry in feed.entries:
        title = entry.get("title", "").strip()
        link = entry.get("link", "")
        pub_date = entry.get("published", "")
        categories = [t.get("term", "") for t in entry.get("tags", [])]

        # Извлекаем контент (content:encoded или description)
        content_raw = ""
        if "content" in entry and len(entry.content) > 0:
            content_raw = entry.content[0].value
        else:
            content_raw = entry.get("description", "")

        # Проверяем наличие изображений
        soup = BeautifulSoup(content_raw, "html.parser")
        images = [img.get("src") for img in soup.find_all("img") if img.get("src")]

        # Очищаем текст
        clean_text = clean_html(content_raw)

        # ФИЛЬТРАЦИЯ БРАКА:
        # Если текста меньше 200 символов — это пустой пост или только фото, пропускаем
        if len(clean_text) < 200:
            continue

        # Проверяем юридическую направленность (суд, постановление, кодекс, права)
        legal_keywords = ["суд", "постанова", "справа", "ухвала", "кпк", "кодекс", "право", "вирок", "скарга", "закон"]
        is_legal = any(kw in clean_text.lower() or kw in title.lower() for kw in legal_keywords)

        if not is_legal:
            continue

        articles.append({
            "title": title,
            "link": link,
            "published": pub_date,
            "categories": categories,
            "text": clean_text,
            "images": images,
            "text_length": len(clean_text),
        })

        if len(articles) >= limit:
            break

    return articles


if __name__ == "__main__":
    print(f"Загрузка RSS фида {FEED_URL}...")
    items = fetch_legal_articles(limit=3)
    print(f"Найдено качественных правовых статей: {len(items)}\n")

    for i, it in enumerate(items, 1):
        print(f"[{i}] {it['title']}")
        print(f"Ссылка: {it['link']}")
        print(f"Длина текста: {it['text_length']} симв.")
        print(f"Фрагмент текста: {it['text'][:250]}...\n")
