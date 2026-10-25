"""P2: B-roll из Pexels (бесплатный API, портретные видео, атрибуция не обязательна
для API-партнёров, но мы всё равно кладём ссылку в описание YouTube-пакета).

Строго опционально: без env PEXELS_API_KEY модуль возвращает None и конвейер
продолжается без B-roll (graceful degradation — «из коробки» без ключей).

Лимиты Pexels: 15 млрд запросов/мес бесплатно, ключ выдаётся мгновенно.
"""
from __future__ import annotations

from pathlib import Path

API_BASE = "https://api.pexels.com/videos/search"


class PexelsUnavailable(RuntimeError):
    """B-roll недоступен: нет ключа / сети / подходящих видео — это НЕ ошибка задачи."""


def search_videos(query: str, api_key: str | None, orientation: str = "portrait",
                  per_page: int = 3, timeout: float = 15.0) -> list[dict]:
    """Найти вертикальные стоковые видео по запросу (тема ролика)."""
    if not api_key:
        raise PexelsUnavailable("B-roll пропущен: не задан PEXELS_API_KEY")
    import httpx

    r = httpx.get(
        API_BASE,
        headers={"Authorization": api_key},
        params={"query": query, "orientation": orientation, "per_page": per_page},
        timeout=timeout,
    )
    r.raise_for_status()
    items = (r.json() or {}).get("videos") or []
    out = []
    for v in items:
        files = [f for f in v.get("video_files", []) if f.get("width", 0) <= 1080]
        if not files:
            continue
        best = sorted(files, key=lambda f: f.get("width", 0))[-1]
        out.append({
            "id": v.get("id"),
            "url": best.get("link"),
            "width": best.get("width"),
            "height": best.get("height"),
            "duration": v.get("duration"),
            "page": v.get("url"),  # для атрибуции в описании
        })
    return out


def download(item: dict, dest: Path, timeout: float = 60.0) -> Path:
    """Скачать файл B-roll в рабочий каталог задачи."""
    import httpx

    if not item.get("url"):
        raise PexelsUnavailable("у стока нет файла ≤1080px")
    with httpx.stream("GET", item["url"], timeout=timeout, follow_redirects=True) as r:
        r.raise_for_status()
        dest.write_bytes(b"".join(chunk for chunk in r.iter_bytes(chunk_size=1 << 16)))
    return dest


def attribution(items: list[dict]) -> str:
    """Строка атрибуции для описания YouTube (добросовестная практика)."""
    links = [str(i.get("page", "")).strip() for i in items if i.get("page")]
    if not links:
        return ""
    return "B-roll: " + ", ".join(dict.fromkeys(links)) + " (Pexels)"


def overlay_broll_cmd(base: Path, broll: Path, out: Path,
                      start: float = 0.0, dur: float = 2.5,
                      opacity: float = 0.55) -> list[str]:
    """Команда наложения: вертикальный B-roll заливает кадр на первые ~2.5 с
    (пока идёт хук) и растворяется — приём из Shorts-практики «динамичный вход»."""
    fade_out_st = max(0.0, start + dur - 0.8)
    filter_complex = (
        f"[1:v]scale=1080:1920:force_original_aspect_ratio=increase,"
        f"crop=1080:1920,setpts=PTS-STARTPTS+{start}/TB,"
        f"format=yuva420p,fade=t=out:st={fade_out_st}:d=0.8:alpha=1[b];"
        f"[0:v][b]overlay=0:0:format=auto[out]"
    )
    return [
        "ffmpeg", "-y", "-i", str(base), "-i", str(broll),
        "-filter_complex", filter_complex,
        "-map", "[out]", "-map", "0:a",
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "21",
        "-c:a", "copy", "-t", f"{start + dur}", str(out),
    ]
