import { NextRequest, NextResponse } from 'next/server';
import { boot } from '@/lib/boot';
import { db } from '@/lib/db';
import { getCurrentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

async function requireAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'admin') return null;
  return user;
}

// GET /api/admin/users
export async function GET() {
  await boot();
  if (!(await requireAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const users = await db.user.findMany({
    orderBy: { createdAt: 'asc' },
    include: { _count: { select: { jobs: true } } },
  });
  return NextResponse.json({ users });
}

// PATCH /api/admin/users — лимиты, роль, блокировка
export async function PATCH(req: NextRequest) {
  await boot();
  if (!(await requireAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const { id, dailyLimit, role, isBlocked } = body;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (typeof dailyLimit === 'number') data.dailyLimit = Math.max(0, Math.min(100, Math.round(dailyLimit)));
  if (role === 'user' || role === 'admin') data.role = role;
  if (typeof isBlocked === 'boolean') data.isBlocked = isBlocked;

  const user = await db.user.update({ where: { id }, data });
  await db.event.create({
    data: { message: `Админ: обновлён профиль ${user.firstName ?? user.username ?? user.telegramId} (${Object.keys(data).join(', ')})` },
  });
  return NextResponse.json({ user });
}
