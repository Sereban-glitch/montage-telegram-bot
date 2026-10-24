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
    // Фича №2: Domdara News Hub
    domdara_enabled: 'true',
    domdara_feed_url: 'http://domdara.org/feed/',
    news_daily_max: '2',
    // Фича №2: YouTube-раздел (OAuth для выгрузки news-Shorts)
    youtube_oauth_status: 'connected',
    youtube_oauth_expires_at: new Date(Date.now() + 45 * 24 * 3600 * 1000).toISOString(),
    youtube_oauth_scope: 'https://www.googleapis.com/auth/youtube.upload',
    youtube_channel_handle: '@humanrightszp',
    youtube_channel_title: 'Свободные Люди Запорожья',
  };
  for (const [key, value] of Object.entries(defaults)) {
    await db.setting.upsert({ where: { key }, update: {}, create: { key, value } });
  }

  // --- Статьи domdara.org (демо-данные News Hub) ---------------------
  const newsCount = await db.newsArticle.count();
  if (newsCount === 0) {
    await db.newsArticle.createMany({
      data: [
        {
          guid: 'http://domdara.org/?p=2031',
          url: 'http://domdara.org/verkhovnyi-sud-subsydiia',
          title: 'Верховный Суд: субсидию нельзя снять без документальной проверки',
          snippet:
            'Суд рассмотрел дело пенсионерки, у которой управлении соцзащиты сняло субсидию без выезда на место. Кассационный суд подтвердил: отмена субсидии возможна только после документальной проверки. Решение защитило миллионы украинцев от произвола чиновников.',
          state: 'new',
          publishedAt: new Date(Date.now() - 3 * 3600 * 1000),
        },
        {
          guid: 'http://domdara.org/?p=2028',
          url: 'http://domdara.org/borg-bez-rozpysky',
          title: 'Как вернуть долг без расписки: прецедент недели',
          snippet:
            'Позивач передав 150 тисяч гривень готівкою без розписки, але за наявності свідків і листування у месенджері. Верховний Суд підтвердив: договір позики можуть підтвердити свідки. Грошове зобов’язання дійсне і без паперу.',
          state: 'new',
          publishedAt: new Date(Date.now() - 9 * 3600 * 1000),
        },
        {
          guid: 'http://domdara.org/?p=2019',
          url: 'http://domdara.org/peni-voennyi-stan',
          title: 'Пени за коммуналку в военное положение: суд стал на сторону людей',
          snippet:
            'Управляюча компанія нарахувала пеню за період воєнного стану. Верховний Суд підтвердив: нараховувати пені під час війни заборонено законом. Прецедент захистить мільйони українців від незаконних нарахувань.',
          state: 'new',
          publishedAt: new Date(Date.now() - 26 * 3600 * 1000),
        },
        {
          guid: 'http://domdara.org/?p=2005',
          url: 'http://domdara.org/photo-konferentsiia',
          title: 'Фотоотчёт с юридической конференции',
          snippet: '',
          state: 'skipped',
          publishedAt: new Date(Date.now() - 30 * 3600 * 1000),
        },
      ],
    });
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
