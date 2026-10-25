"""Выгрузка одобренного news-Short на YouTube (privacyStatus=private).

YouTube Data API v3 resumable upload через httpx (без тяжёлого google-api-python-client):
  1. POST /upload/youtube/v3/videos?uploadType=resumable&part=snippet,status
     → 200 + Location (upload URL)
  2. PUT файла одним запросом (ролики ~5–15 МБ, лимитTelegram'а не задет)
  3. → videos.insert → videoId

Требуется OAuth refresh token (долгоживущий): см. deploy/GO-API-PATCH.md, раздел
«YouTube OAuth» — одноразовый consent-экран owner'а, затем MONTAGE_YT_* в .env воркера.
Публикация ВСЕГДА private — владелец открывает доступ сам в творческой студии.
"""
from __future__ import annotations

import time

import httpx

TOKEN_URL = "https://oauth2.googleapis.com/token"
UPLOAD_URL = "https://www.googleapis.com/upload/youtube/v3/videos"
SCOPE = "https://www.googleapis.com/auth/youtube.upload"


class YouTubeConfigError(RuntimeError):
    """Не заданы MONTAGE_YT_CLIENT_ID / SECRET / REFRESH_TOKEN."""


def refresh_access_token(client_id: str, client_secret: str, refresh_token: str) -> str:
    data = {
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }
    r = httpx.post(TOKEN_URL, data=data, timeout=30)
    r.raise_for_status()
    token = r.json().get("access_token")
    if not token:
        raise RuntimeError(f"Google не вернул access_token: {r.text[:200]}")
    return token


def upload_private(
    video_path: str,
    title: str,
    description: str,
    tags: list[str],
    client_id: str = "",
    client_secret: str = "",
    refresh_token: str = "",
    max_retries: int = 3,
) -> str:
    """Resumable-выгрузка ролика. Возвращает videoId. Всегда privacyStatus=private."""
    if not (client_id and client_secret and refresh_token):
        raise YouTubeConfigError(
            "YouTube OAuth не настроен: нужны MONTAGE_YT_CLIENT_ID, MONTAGE_YT_CLIENT_SECRET, "
            "MONTAGE_YT_REFRESH_TOKEN (см. deploy/GO-API-PATCH.md → «YouTube OAuth»)"
        )

    access = refresh_access_token(client_id, client_secret, refresh_token)
    headers = {"Authorization": f"Bearer {access}", "Content-Type": "application/json"}
    metadata = {
        "snippet": {
            "title": title[:100],
            "description": description[:4900],
            "tags": tags[:15],
            "categoryId": "25",          # News & Politics
            "defaultLanguage": "uk",
            "defaultAudioLanguage": "uk",
        },
        "status": {
            "privacyStatus": "private",  # ТЗ: только private, доступ открывает владелец
            "selfDeclaredMadeForKids": False,
            "embeddable": True,
        },
    }

    # 1) инициализация resumable-сессии
    size = None
    import os

    size = os.path.getsize(video_path)
    last_err: Exception | None = None
    for attempt in range(1, max_retries + 1):
        try:
            init = httpx.post(
                UPLOAD_URL,
                params={"uploadType": "resumable", "part": "snippet,status"},
                headers={**headers, "X-Upload-Content-Length": str(size),
                         "X-Upload-Content-Type": "video/mp4"},
                json=metadata,
                timeout=30,
            )
            init.raise_for_status()
            upload_url = init.headers.get("Location")
            if not upload_url:
                raise RuntimeError(f"Нет Location в ответе Google: {init.text[:200]}")

            # 2) выгрузка файла одним PUT (видео ≤ ~200 МБ ок; наших 5–20 МБ — с запасом)
            with open(video_path, "rb") as f:
                put = httpx.put(
                    upload_url,
                    headers={"Content-Length": str(size), "Content-Type": "video/mp4"},
                    content=f.read(),
                    timeout=600,
                )
            if put.status_code in (200, 201):
                video_id = put.json().get("id")
                if not video_id:
                    raise RuntimeError(f"Google не вернул videoId: {put.text[:200]}")
                return video_id
            if put.status_code == 308:  # resumed не завершён — не ожидаемо при одном PUT
                raise RuntimeError("308: частичная выгрузка, проверьте сеть")
            put.raise_for_status()
        except Exception as e:  # noqa: BLE001
            last_err = e
            time.sleep(2 * attempt)  # линейный бэкофф
    raise RuntimeError(f"Выгрузка на YouTube не удалась после {max_retries} попыток: {last_err}")


def get_video_status(video_id: str, client_id: str, client_secret: str, refresh_token: str) -> dict:
    """Статус обработки/приватности (для карточки модерации)."""
    access = refresh_access_token(client_id, client_secret, refresh_token)
    r = httpx.get(
        "https://www.googleapis.com/youtube/v3/videos",
        params={"part": "status,snippet", "id": video_id},
        headers={"Authorization": f"Bearer {access}"},
        timeout=30,
    )
    r.raise_for_status()
    items = r.json().get("items", [])
    if not items:
        return {"found": False}
    st = items[0].get("status", {})
    return {
        "found": True,
        "privacyStatus": st.get("privacyStatus"),
        "uploadStatus": st.get("uploadStatus"),
        "title": items[0].get("snippet", {}).get("title"),
    }
