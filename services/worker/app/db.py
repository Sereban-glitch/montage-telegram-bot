"""Доступ воркера к общей БД (те же модели, что у backend)."""
from .config import get_settings


def session_factory():
    # Импорт ленивый: переиспользуем модели backend как единый источник схемы
    import sys
    from pathlib import Path

    backend_root = str(Path(__file__).resolve().parents[2] / "backend")
    if backend_root not in sys.path:
        sys.path.insert(0, backend_root)

    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    url = get_settings().database_url
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, connect_args=connect_args, pool_pre_ping=True)
    return sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def log_event(session, job_id: str | None, message: str, level: str = "info") -> None:
    from backend.app.models import Event

    session.add(Event(job_id=job_id, level=level, message=message))
    session.commit()
    print(f"[{level}] {message}", flush=True)
