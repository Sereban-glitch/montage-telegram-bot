import { NextResponse } from 'next/server';
import { boot } from '@/lib/boot';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { parseParams } from '@/lib/seed';

export const dynamic = 'force-dynamic';

// GET /api/admin/youtube — раздел «📢 YouTube Канал»: OAuth + история private-выгрузок
export async function GET() {
  await boot();
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const settings = await db.setting.findMany({
    where: {
      key: {
        in: [
          'youtube_oauth_status', 'youtube_oauth_expires_at', 'youtube_oauth_scope',
          'youtube_channel_handle', 'youtube_channel_title',
        ],
      },
    },
  });
  const s = Object.fromEntries(settings.map((x) => [x.key, x.value]));

  // История выгрузок: news_shorts в статусе uploaded (+ подписанные hook_render в демо)
  const uploaded = await db.job.findMany({
    where: { type: 'news_shorts', approvalStatus: 'uploaded' },
    orderBy: { completedAt: 'desc' },
    take: 10,
  });
  const uploads = uploaded.map((j) => {
    const p = parseParams(j.params);
    const meta = (p.youtube_meta ?? {}) as { title?: string; description?: string; tags?: string[] };
    return {
      jobId: j.id,
      title: meta.title ?? j.sourceName ?? '',
      description: meta.description ?? '',
      tags: meta.tags ?? [],
      videoId: String(p.youtube_video_id ?? ''),
      privacy: 'private' as const,
      uploadedAt: j.completedAt?.toISOString() ?? null,
      kind: j.type,
    };
  });

  return NextResponse.json({
    channel: {
      handle: s.youtube_channel_handle ?? '@humanrightszp',
      title: s.youtube_channel_title ?? 'Свободные Люди Запорожья',
    },
    oauth: {
      status: (s.youtube_oauth_status as 'connected' | 'expired' | 'missing') ?? 'missing',
      expiresAt: s.youtube_oauth_expires_at ?? null,
      scope: s.youtube_oauth_scope ?? 'https://www.googleapis.com/auth/youtube.upload',
    },
    uploads,
  });
}
