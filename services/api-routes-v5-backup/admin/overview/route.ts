import { NextResponse } from 'next/server';
import { boot } from '@/lib/boot';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';
import { systemStats } from '@/lib/virtual-worker';

export const dynamic = 'force-dynamic';

// GET /api/admin/overview — очередь + система + счётчики (только admin)
export async function GET() {
  await boot();
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const [jobs, system, usersCount, completedCount, failedCount, channels] = await Promise.all([
    db.job.findMany({
      where: { status: { in: ['queued', 'processing'] } },
      // Порядок выполнения Zero-Conflict Queue: приоритет ↓, затем FIFO
      orderBy: [{ status: 'asc' }, { priority: 'desc' }, { createdAt: 'asc' }],
      include: { user: { select: { firstName: true, username: true, telegramId: true } } },
    }),
    systemStats(),
    db.user.count(),
    db.job.count({ where: { status: 'completed' } }),
    db.job.count({ where: { status: 'failed' } }),
    db.channel.findMany({ include: { user: { select: { firstName: true, username: true } } } }),
  ]);

  const today = await db.job.count({
    where: { createdAt: { gte: new Date(new Date().setUTCHours(0, 0, 0, 0)) } },
  });

  return NextResponse.json({ jobs, system, usersCount, completedCount, failedCount, todayCount: today, channels });
}
