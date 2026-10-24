import { NextRequest, NextResponse } from 'next/server';
import { boot } from '@/lib/boot';
import { db } from '@/lib/db';
import { getCurrentUser, refreshDailyUsage } from '@/lib/session';

export const dynamic = 'force-dynamic';

// GET /api/jobs — задачи текущего пользователя
export async function GET() {
  await boot();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const jobs = await db.job.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 30,
  });
  return NextResponse.json({ jobs });
}

// POST /api/jobs — создание задачи (multipart с файлом ИЛИ JSON со ссылкой)
export async function POST(req: NextRequest) {
  await boot();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (user.isBlocked) return NextResponse.json({ error: 'Аккаунт заблокирован администратором' }, { status: 403 });

  const fresh = (await refreshDailyUsage(user))!;
  if (fresh.dailyUsed >= fresh.dailyLimit) {
    return NextResponse.json(
      { error: `Дневной лимит исчерпан (${fresh.dailyLimit}). Обратитесь к администратору или повторите завтра.` },
      { status: 429 },
    );
  }

  const contentType = req.headers.get('content-type') ?? '';
  let type = 'short';
  let params: Record<string, unknown> = {};
  let sourceType: string = 'upload';
  let sourceUrl: string | null = null;
  let sourceName: string | null = null;
  let filePath: string | null = null;
  let sizeMb: number | null = null;

  try {
    if (contentType.includes('multipart/form-data')) {
      const form = await req.formData();
      type = String(form.get('type') ?? 'short');
      params = JSON.parse(String(form.get('params') ?? '{}'));
      sourceType = String(form.get('sourceType') ?? 'upload');
      sourceUrl = (form.get('sourceUrl') as string) || null;
      const file = form.get('file') as File | null;
      if (file && file.size > 0) {
        const maxMb = Number((await db.setting.findUnique({ where: { key: 'max_file_mb' } }))?.value ?? 2048);
        if (file.size > maxMb * 1024 * 1024) {
          return NextResponse.json({ error: `Файл больше ${maxMb} МБ` }, { status: 413 });
        }
        sourceName = file.name;
        sizeMb = Number((file.size / 1048576).toFixed(1));
        // В песочнице сохраняем метаданные и небольшой файл; в проде воркер
        // забирает файл из /data/media/<jobId>/source (общий том).
        const fs = await import('fs');
        const path = await import('path');
        if (file.size < 64 * 1024 * 1024) {
          const dir = path.join('/home/z/my-project/uploads', `pending-${Date.now()}`);
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(path.join(dir, file.name), Buffer.from(await file.arrayBuffer()));
          filePath = path.join(dir, file.name);
        }
      }
    } else {
      const body = await req.json();
      type = String(body.type ?? 'short');
      params = body.params ?? {};
      sourceType = String(body.sourceType ?? 'youtube');
      sourceUrl = body.sourceUrl ?? null;
      sourceName = body.sourceName ?? null;
    }
  } catch {
    return NextResponse.json({ error: 'Некорректное тело запроса' }, { status: 400 });
  }

  if (!['short', 'long'].includes(type)) {
    return NextResponse.json({ error: 'type должен быть short или long' }, { status: 400 });
  }
  if (sourceType !== 'upload' && !sourceUrl) {
    return NextResponse.json({ error: 'Укажите ссылку на видео' }, { status: 400 });
  }
  if (sourceType === 'upload' && !filePath && !sourceUrl) {
    // в демо разрешаем «загрузку» без файла только если указано имя
    if (!sourceName) return NextResponse.json({ error: 'Прикрепите видеофайл или укажите ссылку' }, { status: 400 });
  }

  const job = await db.job.create({
    data: {
      userId: user.id,
      type,
      status: 'queued',
      sourceType,
      sourceUrl,
      sourceName: sourceName ?? (sourceUrl ? new URL(sourceUrl).hostname : 'видео.mp4'),
      filePath,
      sizeMb,
      params: JSON.stringify(params),
    },
  });

  await db.user.update({ where: { id: user.id }, data: { dailyUsed: { increment: 1 } } });
  await db.event.create({
    data: {
      jobId: job.id,
      message: `Новая задача ${type === 'long' ? 'Long' : 'Short'} от ${user.firstName ?? user.username ?? user.telegramId} — в очереди (позиция ${await db.job.count({ where: { status: 'queued' } })})`,
    },
  });

  return NextResponse.json({ job }, { status: 201 });
}
