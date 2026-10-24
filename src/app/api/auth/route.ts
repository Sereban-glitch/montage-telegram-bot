import { NextRequest, NextResponse } from 'next/server';
import { boot } from '@/lib/boot';
import { db } from '@/lib/db';
import { validateInitData } from '@/lib/telegram';
import { setSession, getCurrentUser, clearSession, refreshDailyUsage } from '@/lib/session';

export const dynamic = 'force-dynamic';

// GET /api/auth — текущий пользователь
export async function GET() {
  await boot();
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  const fresh = await refreshDailyUsage(user);
  return NextResponse.json({ user: fresh });
}

// POST /api/auth — вход: реальная Telegram initData ИЛИ демо-режим в браузере
export async function POST(req: NextRequest) {
  await boot();
  const body = await req.json().catch(() => ({}));
  const initData: string | undefined = body.initData;

  const botToken = process.env.TELEGRAM_BOT_TOKEN;

  if (initData && botToken) {
    const { valid, user: tgUser } = validateInitData(initData, botToken);
    if (!valid || !tgUser) {
      return NextResponse.json({ error: 'Подпись initData недействительна' }, { status: 401 });
    }
    const user = await db.user.upsert({
      where: { telegramId: String(tgUser.id) },
      update: {
        username: tgUser.username ?? null,
        firstName: tgUser.first_name ?? null,
        photoUrl: tgUser.photo_url ?? null,
      },
      create: {
        telegramId: String(tgUser.id),
        username: tgUser.username ?? null,
        firstName: tgUser.first_name ?? null,
        photoUrl: tgUser.photo_url ?? null,
        role: 'user',
        dailyLimit: 3,
      },
    });
    await setSession(user.id);
    return NextResponse.json({ user, mode: 'telegram' });
  }

  // Демо-режим (песочница вне Telegram): входим как владелец канала
  const admin = await db.user.findFirst({ where: { role: 'admin' } });
  if (!admin) return NextResponse.json({ error: 'seed missing' }, { status: 500 });
  await setSession(admin.id);
  return NextResponse.json({ user: admin, mode: 'demo' });
}

// DELETE /api/auth — выход
export async function DELETE() {
  await clearSession();
  return NextResponse.json({ ok: true });
}
