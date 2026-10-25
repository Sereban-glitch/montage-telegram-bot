"""Конфиг воркера."""
from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "sqlite+aiosqlite:///./data/kitchen.db"
    media_dir: str = "./data/media"

    # Корень репозитория движка Sereban-glitch-video-montage (клон v2.0.0)
    engine_repo: str = "/opt/Sereban-glitch-video-montage"
    # Профиль канала по умолчанию (profiles/<key>.json)
    default_profile: str = "humanrightszp"

    # Модели Whisper (faster-whisper, CPU int8)
    whisper_model_short: str = "small"
    whisper_model_long: str = "large-v3-turbo"

    # Диагностика без реального движка (для CI/проверки деплоя)
    dry_run: bool = False

    # ------------------------------------------------------------------
    # Фича №1: AI Hook Finder (YouTube → фрагменты → меню выбора)
    # ------------------------------------------------------------------
    hook_min_dur: float = 35.0       # короче — не удержать зрителя
    hook_max_dur: float = 55.0       # длиннее — провисает
    hook_max_candidates: int = 5     # в меню показываем 3–5

    # ------------------------------------------------------------------
    # Фича №2: domdara.org → News Shorts (фоновый конвейер, priority=1)
    # ------------------------------------------------------------------
    domdara_enabled: bool = True
    domdara_feed_url: str = "http://domdara.org/feed/"
    domdara_interval_min: int = 240  # опрос RSS раз в 4 часа
    news_daily_max: int = 2          # не спамим: максимум news-Shorts в сутки
    news_voice: str = "uk-UA-OstapNeural"
    news_voice_alt: str = "uk-UA-PolinaNeural"
    # Статьи domdara.org часто по-русски: укрголос на русском тексте звучит неестественно,
    # поэтому язык озвучки следует языку статьи (LLM-перевод на укр. — опц. путь)
    news_voice_ru: str = "ru-RU-DmitryNeural"
    news_voice_ru_alt: str = "ru-RU-SvetlanaNeural"

    # ------------------------------------------------------------------
    # Прямая доставка воркером (прод, pull-модель): токен бота + чат модерации
    # Пусто → канонический путь: помечаем notified, бот доставит сам
    # ------------------------------------------------------------------
    tg_bot_token: str = ""
    owner_telegram_id: str = ""      # модерация news_shorts (Human-in-the-Loop)

    # ------------------------------------------------------------------
    # YouTube Data API (выгрузка одобренных news-Shorts, всегда private)
    # ------------------------------------------------------------------
    yt_client_id: str = ""
    yt_client_secret: str = ""
    yt_refresh_token: str = ""

    # Опциональный LLM-рефайнер заголовков (OpenAI-совместимый API; без ключа — правила)
    llm_api_key: str = ""
    llm_base_url: str = ""
    llm_model: str = ""

    # ------------------------------------------------------------------
    # P0–P3 (апгрейд 2026-10): улучшения монтажа
    # ------------------------------------------------------------------
    music_dir: str = "/data/music"     # CC0-треки владельца; пусто → процедурный подклад
    pexels_api_key: str = ""           # B-roll (опционально, бесплатно)
    preview_height: int = 960          # превью-ролики хуков 540×960…1080×1920


@lru_cache
def get_settings() -> Settings:
    return Settings()
