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

// GET /api/admin/settings
export async function GET() {
  await boot();
  if (!(await requireAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const settings = await db.setting.findMany();
  return NextResponse.json({ settings });
}

// PUT /api/admin/settings — { key: value, ... }
export async function PUT(req: NextRequest) {
  await boot();
  if (!(await requireAdmin())) return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as Record<string, string | number | boolean>;
  for (const [key, value] of Object.entries(body)) {
    await db.setting.upsert({ where: { key }, update: { value: String(value) }, create: { key, value: String(value) } });
    await db.event.create({ data: { message: `Админ: настройка ${key} → ${value}` } });
  }
  const settings = await db.setting.findMany();
  return NextResponse.json({ settings });
}
