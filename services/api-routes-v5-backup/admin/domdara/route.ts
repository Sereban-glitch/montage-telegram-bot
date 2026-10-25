import { NextRequest, NextResponse } from 'next/server';
import { boot } from '@/lib/boot';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { parseParams } from '@/lib/seed';

export const dynamic = 'force-dynamic';

// GET /api/admin/domdara — статьи News Hub + связанные задачи (только admin)
export async function GET() {
  await boot();
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const articles = await db.newsArticle.findMany({
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: { job: true },
  });

  const settings = await db.setting.findMany({
    where: { key: { in: ['domdara_enabled', 'domdara_feed_url', 'news_daily_max'] } },
  });
  const s = Object.fromEntries(settings.map((x) => [x.key, x.value]));

  return NextResponse.json({
    articles,
    feed: {
      url: s.domdara_feed_url ?? 'http://domdara.org/feed/',
      enabled: s.domdara_enabled !== 'false',
      dailyMax: Number(s.news_daily_max ?? 2),
    },
  });
}

// POST /api/admin/domdara — действия владельца: generate | approve | reject | regenerate
export async function POST(req: NextRequest) {
  await boot();
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    articleId?: string;
    jobId?: string;
  };
  const action = body.action ?? '';

  if (action === 'generate' && body.articleId) {
    const article = await db.newsArticle.findUnique({ where: { id: body.articleId } });
    if (!article) return NextResponse.json({ error: 'Статья не найдена' }, { status: 404 });
    if (!article.snippet || article.snippet.length < 80) {
      return NextResponse.json({ error: 'Брак: фото-пост без содержательного текста (фильтр качества)' }, { status: 422 });
    }
    // Синглтон фоновой задачи: не ставим вторую news_shorts, пока одна в очереди/работе
    const active = await db.job.count({
      where: { type: 'news_shorts', status: { in: ['queued', 'processing'] } },
    });
    if (active > 0) {
      return NextResponse.json(
        { error: 'Фоновая генерация уже в очереди — Zero-Conflict Queue пропустит её только после задач друзей' },
        { status: 409 },
      );
    }
    const job = await db.job.create({
      data: {
        userId: user.id,
        type: 'news_shorts',
        status: 'queued',
        priority: 1, // фон: берётся только когда нет задач друзей
        sourceType: 'link',
        sourceName: article.title.slice(0, 120),
        sourceUrl: article.url,
        params: JSON.stringify({
          article_id: article.id,
          article_url: article.url,
          article_title: article.title,
          article_text: article.snippet,
          variant: 0,
        }),
      },
    });
    await db.newsArticle.update({ where: { id: article.id }, data: { state: 'queued', jobId: job.id } });
    await db.event.create({
      data: { jobId: job.id, message: `Domdara Hub: фоновая генерация News Short (priority=1) — «${article.title.slice(0, 60)}»` },
    });
    return NextResponse.json({ job }, { status: 201 });
  }

  if (body.jobId && ['approve', 'reject', 'regenerate'].includes(action)) {
    const job = await db.job.findUnique({ where: { id: body.jobId } });
    if (!job || job.type !== 'news_shorts') {
      return NextResponse.json({ error: 'news_shorts задача не найдена' }, { status: 404 });
    }
    if (!['pending', 'upload_failed'].includes(job.approvalStatus ?? '')) {
      return NextResponse.json({ error: `Задача уже в статусе ${job.approvalStatus}` }, { status: 409 });
    }
    if (action === 'approve') {
      await db.job.update({ where: { id: job.id }, data: { approvalStatus: 'approved' } });
      await db.event.create({
        data: { jobId: job.id, message: 'Модерация: владелец одобрил — выгрузка на YouTube (private) запущена' },
      });
    } else if (action === 'reject') {
      await db.job.update({ where: { id: job.id }, data: { approvalStatus: 'rejected' } });
      await db.newsArticle.updateMany({ where: { jobId: job.id }, data: { state: 'rejected' } });
      await db.event.create({ data: { jobId: job.id, message: 'Модерация: владелец отклонил News Short' } });
    } else {
      const params = parseParams(job.params);
      const article = await db.newsArticle.findUnique({ where: { id: String(params.article_id ?? '') } });
      await db.job.update({ where: { id: job.id }, data: { approvalStatus: 'regenerated' } });
      if (article) {
        const newJob = await db.job.create({
          data: {
            userId: user.id,
            type: 'news_shorts',
            status: 'queued',
            priority: 10, // перегенерация инициирована владельцем — интерактивный приоритет
            sourceType: 'link',
            sourceName: article.title.slice(0, 120),
            sourceUrl: article.url,
            params: JSON.stringify({ ...params, variant: Number(params.variant ?? 0) + 1 }),
          },
        });
        await db.newsArticle.update({ where: { id: article.id }, data: { jobId: newJob.id } });
        await db.event.create({
          data: { jobId: newJob.id, message: `Перегенерация: вариант ${Number(params.variant ?? 0) + 1} (priority=10)` },
        });
      }
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 });
}
