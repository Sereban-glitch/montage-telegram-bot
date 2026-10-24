import { db } from '@/lib/db';

// ---------------------------------------------------------------
// Идемпотентный сидинг демо-данных (выполняется при первом запросе)
// ---------------------------------------------------------------

let seeded = false;

export async function ensureSeed() {
  if (seeded) return;
  seeded = true;

  // --- Пользователи -------------------------------------------------
  const admin = await db.user.upsert({
    where: { telegramId: '100000001' },
    update: {},
    create: {
      telegramId: '100000001',
      username: 'svobodnye_ludi_zp',
      firstName: 'Сергей (владелец канала)',
      role: 'admin',
      dailyLimit: 10,
    },
  });

  const friend = await db.user.upsert({
    where: { telegramId: '100000002' },
    update: {},
    create: {
      telegramId: '100000002',
      username: 'ivan_friend',
      firstName: 'Иван (друг канала)',
      role: 'user',
      dailyLimit: 3,
    },
  });

  // --- Канал YouTube ------------------------------------------------
  const ch = await db.channel.findFirst({ where: { userId: admin.id } });
  if (!ch) {
    await db.channel.create({
      data: {
        userId: admin.id,
        provider: 'youtube',
        channelId: 'UC1KtjDqNXlN6qqXVUh0Y5Mw',
        channelTitle: 'Свободные Люди Запорожья',
        handle: '@humanrightszp',
        profileKey: 'humanrightszp',
        status: 'connected',
      },
    });
  }

  // --- Витрина ------------------------------------------------------
  const count = await db.showcaseItem.count();
  if (count === 0) {
    await db.showcaseItem.createMany({
      data: [
        {
          kind: 'short',
          title: 'КСУ: правительство не может само ограничивать права',
          subtitle: 'Нарезка решения КСУ • 3 субстроки • EBU R128',
          thumbUrl: '/showcase/short-court.png',
          videoUrl: '/demo/final_short.mp4',
          durationSec: 106,
          views: 12400,
          featured: true,
          sort: 1,
        },
        {
          kind: 'short',
          title: 'Судовое засідання: відвід судді',
          subtitle: 'Автонарезка динамики • вертикальная обложка',
          thumbUrl: '/showcase/short-street.png',
          videoUrl: '/demo/final_short.mp4',
          durationSec: 58,
          views: 8300,
          featured: false,
          sort: 2,
        },
        {
          kind: 'short',
          title: 'Пресконференція: що змінить рішення?',
          subtitle: 'Двуязычные субтитры укр → рус',
          thumbUrl: '/showcase/short-press.png',
          videoUrl: '/demo/final_short.mp4',
          durationSec: 74,
          views: 5600,
          featured: false,
          sort: 3,
        },
        {
          kind: 'short',
          title: 'Интервью: права человека на практике',
          subtitle: 'Плашка «ЩО ЦЕ ЗМІНЮЄ?» • титул 2 строки',
          thumbUrl: '/showcase/short-mic.png',
          videoUrl: '/demo/final_short.mp4',
          durationSec: 45,
          views: 3900,
          featured: false,
          sort: 4,
        },
        {
          kind: 'long',
          title: 'Судове засідання у Запоріжжі — повна версія',
          subtitle: 'Вырезаны паузы > 3 сек • главы в описании',
          thumbUrl: '/showcase/long-session.png',
          videoUrl: '/demo/final_short.mp4',
          durationSec: 4820,
          views: 21700,
          featured: true,
          sort: 5,
        },
        {
          kind: 'long',
          title: 'Публічна лекція — очищена версія з субтитрами',
          subtitle: 'Whisper large-v3-turbo • сегментный рендер',
          thumbUrl: '/showcase/long-lecture.png',
          videoUrl: '/demo/final_short.mp4',
          durationSec: 3610,
          views: 9800,
          featured: false,
          sort: 6,
        },
      ],
    });
  }

  // --- Настройки ----------------------------------------------------
  const defaults: Record<string, string> = {
    worker_enabled: 'true',
    global_daily_limit: '3',
    max_file_mb: '2048',
    worker_ram_budget_mb: '8192',
  };
  for (const [key, value] of Object.entries(defaults)) {
    await db.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  // --- Системный лог ------------------------------------------------
  const events = await db.event.count();
  if (events === 0) {
    await db.event.createMany({
      data: [
        { level: 'info', message: 'Worker: слот рендера свободен, RAM 2.1/12.0 ГБ' },
        { level: 'info', message: 'Engine: Sereban-glitch-video-montage v2.0.0 подключен' },
        { level: 'info', message: 'Система готова к приёму задач' },
      ],
    });
  }

  return { admin, friend };
}

// Разбор JSON-параметров задачи
export function parseParams(raw: string | null | undefined): Record<string, unknown> {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
