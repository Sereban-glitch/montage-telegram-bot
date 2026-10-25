"""FIFO-воркер с приоритетной бесконфликтной очередью (Zero-Conflict Queue).

Защита сервера 12 ГБ ОЗУ: параллельные тяжёлые рендеры запрещены по построению.
Цикл: claim (атомарно) → pipeline → completed/failed → следующий.

Zero-Conflict Queue — три слоя защиты:
  1. claim_next() берёт задачи ВСЕГДА по убыванию priority: живые пользователи
     (priority=10) вырываются вперёд фоновых генераций (priority=1) независимо
     от времени постановки в очередь.
  2. domdara-планировщик срабатывает ТОЛЬКО в idle-такте (claim вернул None) —
     фон никогда не занимает слот рендера, пока есть работа людей.
  3. Синглтон фоновой задачи: одновременно не более одной news_shorts в очереди
     + дневной лимит (news_daily_max).

Запуск: python -m app.main
"""
import json
import signal
import time
from datetime import datetime, timezone

from sqlalchemy import func, select, update

from .config import get_settings
from .db import log_event, session_factory
from .engine import LongParams, ShortParams, Workspace
from .pipeline import (
    download_source, extract_audio, finalize, render_long, render_short, transcribe,
    run_hook_analysis, run_hook_render, run_news_shorts,
)

# backend-модели как единый источник схемы
import sys  # noqa: E402
from pathlib import Path  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from backend.app.models import Event, Job, NewsArticle, Setting, User, new_id  # noqa: E402

_settings = get_settings()
_stop = False
_last_domdara_poll = 0.0


def _handle(sig, frame):
    global _stop
    _stop = True
    print("SIGTERM: завершаем текущую задачу и выходим", flush=True)


signal.signal(signal.SIGTERM, _handle)
signal.signal(signal.SIGINT, _handle)


def worker_enabled(session) -> bool:
    row = session.scalar(select(Setting).where(Setting.key == "worker_enabled"))
    return (row.value if row else "true") != "false"


def claim_next(session) -> Job | None:
    """Атомарный claim: СНАЧАЛА интерактив (priority=10), потом фоновые (priority=1).

    Внутри каждого приоритета — старейшая задача (FIFO). Устойчиво к гонкам:
    UPDATE ... WHERE status='queued' возвращает 0 строк, если задачу перехватили.
    """
    next_id = session.scalar(
        select(Job.id)
        .where(Job.status == "queued")
        .order_by(Job.priority.desc(), Job.created_at.asc())
        .limit(1)
    )
    if not next_id:
        return None
    claimed = session.execute(
        update(Job)
        .where(Job.id == next_id, Job.status == "queued")
        .values(status="processing", started_at=datetime.now(timezone.utc), stage_key="download",
                stage_label="Загрузка видео", progress=0)
    )
    session.commit()
    if claimed.rowcount == 0:
        return None
    return session.get(Job, next_id)


def parse_params(raw: str) -> dict:
    try:
        return json.loads(raw or "{}")
    except json.JSONDecodeError:
        return {}


def process(session, job: Job) -> None:
    ws = Workspace.for_job(job.id)
    log_event(session, job.id,
              f"Воркер: задача {job.type.upper()} «{job.source_name or ''}» принята "
              f"(priority={job.priority}, слот рендера захвачен)")

    params = parse_params(job.params)

    # ── Фича №1: AI Hook Finder ─────────────────────────────────
    if job.type == "hook_analysis":
        run_hook_analysis(session, job)
        return
    if job.type == "hook_render":
        run_hook_render(session, job)
        return
    # ── Фича №2: domdara → News Shorts ──────────────────────────
    if job.type == "news_shorts":
        run_news_shorts(session, job)
        return

    # ── Канонические конвейеры (Short / Long) ───────────────────
    if job.type == "short":
        sp = ShortParams(
            title_line1=params.get("title_line1", ""),
            title_line2=params.get("title_line2", ""),
            overlay_label=params.get("overlay_label", "КСУ"),
            pill_text=params.get("pill_text", ""),
            speech_lang=params.get("speech_lang", "uk"),
            subtitle_lang=params.get("subtitle_lang", "ru"),
            bilingual=bool(params.get("bilingual", True)),
            cover_frame=int(params.get("cover_frame", 35)),
            remove_silence=bool(params.get("remove_silence", True)),
            sfx=bool(params.get("sfx", False)),
            music=bool(params.get("music", False)),
            dub=bool(params.get("dub", False)),
            # 🎬 Целевая длительность готового ролика (⚡60 / ⏱️90 / 🎬180 сек)
            target_duration=params.get("target_duration", "short"),
        )
        download_source(session, ws, job)
        extract_audio(session, ws)
        transcribe(session, ws, _settings.whisper_model_short)
        render_short(session, ws, sp)
    else:
        lp = LongParams(
            max_gap=float(params.get("max_gap", 3.0)),
            pad=float(params.get("pad", 0.6)),
            whisper_model=params.get("whisper_model", _settings.whisper_model_long),
            chapters=bool(params.get("chapters", True)),
            meta_title=params.get("meta_title", ""),
        )
        download_source(session, ws, job)
        extract_audio(session, ws)
        transcribe(session, ws, lp.whisper_model)
        render_long(session, ws, lp, lp.meta_title)

    finalize(session, ws, job)


# ----------------------------------------------------------------
# Фича №2: фоновый планировщик domdara.org (запускается ТОЛЬКО в idle)
# ----------------------------------------------------------------

def maybe_run_domdara(session) -> None:
    """Gate-функция: RSS опрашивается по интервалу, задачи ставятся только когда
    (1) очередь живых пользователей пуста, (2) нет активной фоновой задачи,
    (3) не превышен дневной лимит. Любая ошибка сети не ломает цикл воркера."""
    global _last_domdara_poll
    s = _settings
    if not s.domdara_enabled:
        return
    now = time.time()
    if now - _last_domdara_poll < s.domdara_interval_min * 60:
        return
    _last_domdara_poll = now

    interactive = session.scalar(
        select(func.count(Job.id)).where(Job.status == "queued", Job.priority >= 10)
    )
    if interactive:
        log_event(session, None, f"Domdara: очередь живых пользователей не пуста ({interactive}) — пропускаем опрос")
        return
    active_news = session.scalar(
        select(func.count(Job.id)).where(Job.type == "news_shorts",
                                         Job.status.in_(("queued", "processing")))
    )
    if active_news:
        return  # фоновая задача уже в работе — синглтон

    try:
        from . import domdara_rss

        items = domdara_rss.fetch_feed(s.domdara_feed_url)
        new_items, seen = domdara_rss.dedup_new_items(session, items)
        if not new_items:
            return
        owner = session.scalars(select(User).where(User.role == "admin").order_by(User.created_at.asc())).first()
        jobs = domdara_rss.enqueue_news_jobs(
            session, new_items, daily_max=s.news_daily_max,
            owner_user_id=owner.id if owner else "",
        )
        log_event(session, None,
                  f"Domdara RSS: записей {len(items)}, новых {len(new_items)}, "
                  f"поставлено фоновых задач {len(jobs)} (priority=1)")
    except Exception as exc:  # noqa: BLE001 — RSS-сбой не должен будить слот рендера
        log_event(session, None, f"Domdara RSS недоступен: {str(exc)[:200]}", level="warn")


# ----------------------------------------------------------------
# Human-in-the-Loop: обработка решений владельца (approve/regenerate/reject)
# ----------------------------------------------------------------

def maybe_process_approvals(session) -> None:
    """Лёгкий IO-цикл (не занимает слот рендера): выгрузка approved на YouTube (private),
    перегенерация по кнопке, зачистка отклонённых. Выполняется каждый такт, но
    фактически работает только при наличии решений."""
    from .config import get_settings
    from .notify import Notifier, approval_text
    from .youtube_uploader import upload_private

    s = get_settings()

    # 1) Одобрено → YouTube private
    approved = session.scalars(select(Job).where(
        Job.type == "news_shorts", Job.status == "completed",
        Job.approval_status == "approved",
    ).order_by(Job.completed_at.asc())).all()
    for job in approved:
        params = parse_params(job.params)
        meta = params.get("youtube_meta", {})
        final = Workspace.for_job(job.id).final
        if not final.exists():
            session.execute(update(Job).where(Job.id == job.id).values(approval_status="upload_failed"))
            session.commit()
            log_event(session, job.id, "YouTube: final.mp4 удалён до выгрузки — задача помечена upload_failed", level="error")
            continue
        try:
            video_id = upload_private(
                str(final), meta.get("title", job.source_name or "Рішення суду"),
                meta.get("description", ""), meta.get("tags", []),
                client_id=s.yt_client_id, client_secret=s.yt_client_secret,
                refresh_token=s.yt_refresh_token,
            )
            base = parse_params(job.params)
            base["youtube_video_id"] = video_id
            session.execute(update(Job).where(Job.id == job.id).values(
                approval_status="uploaded",
                params=json.dumps(base, ensure_ascii=False),
                stage_label=f"Выгружено на YouTube (private): youtu.be/{video_id}",
            ))
            article = session.query(NewsArticle).filter(NewsArticle.job_id == job.id).first()
            if article:
                article.state = "approved"
            session.commit()
            log_event(session, job.id, f"YouTube: выгружено private → https://youtu.be/{video_id}")
            _notify_owner(s, job, f"✅ <b>Ролик выгружен на YouTube (private)</b>\nhttps://youtu.be/{video_id}\n\nОткрыть доступ — в творческой студии.")
            import shutil
            shutil.rmtree(Workspace.for_job(job.id).root, ignore_errors=True)
        except Exception as exc:  # noqa: BLE001
            session.rollback()
            session.execute(update(Job).where(Job.id == job.id).values(approval_status="upload_failed"))
            session.commit()
            log_event(session, job.id, f"YouTube upload ошибка: {str(exc)[:300]}", level="error")
            _notify_owner(s, job, f"⚠️ Выгрузка на YouTube не удалась: <code>{str(exc)[:150]}</code>\nРолик сохранён — можно повторить одобрение.")

    # 2) Перегенерировать → новая задача (приоритет владельца), старая — regenerated
    regen = session.scalars(select(Job).where(
        Job.type == "news_shorts", Job.status == "completed",
        Job.approval_status == "regenerate",
    )).all()
    for job in regen:
        params = parse_params(job.params)
        new_job = Job(
            id=new_id(), user_id=job.user_id, type="news_shorts", status="queued",
            priority=10,  # владелец кликнул — это уже интерактивная задача
            source_type=job.source_type, source_name=job.source_name, source_url=job.source_url,
            params=json.dumps({
                **params, "variant": int(params.get("variant", 0)) + 1,
            }, ensure_ascii=False),
        )
        session.add(new_job)
        session.execute(update(Job).where(Job.id == job.id).values(approval_status="regenerated"))
        article = session.query(NewsArticle).filter(NewsArticle.job_id == job.id).first()
        if article:
            article.job_id = new_job.id
        session.commit()
        log_event(session, new_job.id, f"Перегенерация: вариант {int(params.get('variant', 0)) + 1} поставлена в очередь (priority=10)")

    # 3) Отклонено → зачистка
    rejected = session.scalars(select(Job).where(
        Job.type == "news_shorts", Job.status == "completed",
        Job.approval_status == "rejected",
    )).all()
    for job in rejected:
        import shutil
        shutil.rmtree(Workspace.for_job(job.id).root, ignore_errors=True)
        article = session.query(NewsArticle).filter(NewsArticle.job_id == job.id).first()
        if article:
            article.state = "rejected"
        session.execute(update(Job).where(Job.id == job.id).values(approval_status="rejected_done"))
        session.commit()
        log_event(session, job.id, "News Short отклонён владельцем — файлы удалены")


def _notify_owner(s, job: Job, text: str) -> None:
    from .notify import Notifier

    notifier = Notifier(s.tg_bot_token)
    chat = s.owner_telegram_id or ""
    if not chat and job.user is not None:
        chat = job.user.telegram_id
    if chat:
        notifier.notify(chat, text)


def requeue_positions(session) -> None:
    """Позиции очереди считаем в порядке ВЫПОЛНЕНИЯ: priority DESC → created_at ASC."""
    rows = session.scalars(
        select(Job).where(Job.status == "queued")
        .order_by(Job.priority.desc(), Job.created_at.asc())
    ).all()
    for i, job in enumerate(rows):
        if job.queue_position != i + 1:
            session.execute(update(Job).where(Job.id == job.id).values(queue_position=i + 1))
    session.commit()


def main() -> None:
    Session = session_factory()
    log_event(Session(), None,
              "Worker: слот рендера свободен; Zero-Conflict Queue активна "
              "(priority 10 = люди, 1 = фоновые news); движок v2.0.0 подключен; "
              "конвейеры: short | long | hook_analysis | hook_render | news_shorts")
    print("FIFO worker started; media =", _settings.media_dir, flush=True)

    while not _stop:
        session = Session()
        try:
            if not worker_enabled(session):
                time.sleep(3)
                continue

            # Лёгкие фоновые циклы — до claim: не занимают слот рендера
            maybe_process_approvals(session)

            job = claim_next(session)
            if job is None:
                requeue_positions(session)
                maybe_run_domdara(session)  # фон только в idle — друзья всегда первыми
                time.sleep(3)
                continue

            try:
                process(session, job)
            except Exception as exc:  # noqa: BLE001 — любая ошибка конвейера не убивает воркер
                session.rollback()
                session.execute(
                    update(Job).where(Job.id == job.id).values(
                        status="failed", error=str(exc)[:500],
                        stage_label="Ошибка", completed_at=datetime.now(timezone.utc),
                    )
                )
                session.commit()
                log_event(session, job.id, f"Ошибка задачи: {str(exc)[:300]}", level="error")
            finally:
                session.execute(
                    update(Job).where(Job.id == job.id, Job.status == "processing").values(queue_position=0)
                )
                session.commit()
                requeue_positions(session)
        except Exception as loop_exc:  # noqa: BLE001
            print("Loop error:", loop_exc, flush=True)
            time.sleep(5)
        finally:
            session.close()


if __name__ == "__main__":
    main()
