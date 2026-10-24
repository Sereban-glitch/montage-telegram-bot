import { NextRequest, NextResponse } from 'next/server';
import { boot } from '@/lib/boot';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

// GET /api/jobs/[id] — статус задачи + поток событий
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await boot();
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const job = await db.job.findUnique({ where: { id }, include: { events: { orderBy: { createdAt: 'asc' }, take: 100 } } });
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (job.userId !== user.id && user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  return NextResponse.json({ job });
}

// DELETE /api/jobs/[id] — отмена задачи
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  await boot();
  const { id } = await ctx.params;
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  const job = await db.job.findUnique({ where: { id } });
  if (!job) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (job.userId !== user.id && user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }
  if (['completed', 'cancelled'].includes(job.status)) {
    return NextResponse.json({ error: 'Задача уже завершена' }, { status: 400 });
  }

  const updated = await db.job.update({
    where: { id },
    data: { status: 'cancelled', stageLabel: 'Отменено пользователем', completedAt: new Date() },
  });
  await db.event.create({ data: { jobId: id, level: 'warn', message: 'Задача отменена пользователем, слот и временные файлы освобождены' } });
  return NextResponse.json({ job: updated });
}
