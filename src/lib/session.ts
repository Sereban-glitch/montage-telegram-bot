import { cookies } from 'next/headers';
import { db } from '@/lib/db';
import { signSession, verifySession } from '@/lib/telegram';

export const SESSION_COOKIE = 'mk_session';

export async function setSession(userId: string) {
  const jar = await cookies();
  jar.set(SESSION_COOKIE, signSession(userId), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
}

export async function getCurrentUser() {
  const jar = await cookies();
  const userId = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!userId) return null;
  return db.user.findUnique({ where: { id: userId } });
}

// Ежедневные квоты: счётчик сбрасывается раз в сутки
export async function refreshDailyUsage(user: { id: string; dailyUsed: number; usageResetAt: Date }) {
  const now = new Date();
  const reset = new Date(user.usageResetAt);
  const stale =
    now.getUTCFullYear() !== reset.getUTCFullYear() ||
    now.getUTCMonth() !== reset.getUTCMonth() ||
    now.getUTCDate() !== reset.getUTCDate();
  if (stale) {
    return db.user.update({ where: { id: user.id }, data: { dailyUsed: 0, usageResetAt: now } });
  }
  return db.user.findUnique({ where: { id: user.id } });
}
