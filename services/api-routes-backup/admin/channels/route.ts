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

// GET /api/admin/channels
export async function GET() {
  await boot();
  if (!(await requireAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const channels = await db.channel.findMany({ include: { user: { select: { firstName: true, username: true } } } });
  return NextResponse.json({ channels });
}

// PATCH /api/admin/channels — симуляция OAuth-подключения/отключения
export async function PATCH(req: NextRequest) {
  await boot();
  if (!(await requireAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const status = ['pending', 'connected', 'error'].includes(body.status) ? body.status : 'pending';
  const channel = await db.channel.update({ where: { id: body.id }, data: { status } });
  await db.event.create({
    data: { message: `Админ: канал ${channel.channelTitle ?? channel.id} → ${status}` },
  });
  return NextResponse.json({ channel });
}
