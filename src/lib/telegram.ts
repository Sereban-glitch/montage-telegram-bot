import crypto from 'crypto';

// ================================================================
// Проверка подписи Telegram WebApp initData (тот же алгоритм, что
// реализован в services/backend/app/security.py для FastAPI).
// ================================================================

export type TgUser = {
  id: number;
  first_name?: string;
  username?: string;
  photo_url?: string;
};

export function validateInitData(initData: string, botToken: string): { valid: boolean; user?: TgUser; authDate?: number } {
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return { valid: false };

  params.delete('hash');
  params.delete('signature');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (computed !== hash) return { valid: false };

  let user: TgUser | undefined;
  try {
    user = JSON.parse(params.get('user') ?? 'null') ?? undefined;
  } catch {
    user = undefined;
  }
  const authDate = Number(params.get('auth_date') ?? 0);
  return { valid: true, user, authDate };
}

// ---------------------------------------------------------------
// Сессионные токены (подпись HMAC — продакшн: JWT в FastAPI)
// ---------------------------------------------------------------

const SECRET = process.env.AUTH_SECRET || 'montage-kitchen-dev-secret';

export function signSession(userId: string): string {
  const mac = crypto.createHmac('sha256', SECRET).update(userId).digest('hex').slice(0, 32);
  return `${userId}.${mac}`;
}

export function verifySession(token: string | undefined | null): string | null {
  if (!token || !token.includes('.')) return null;
  const [userId, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(userId).digest('hex').slice(0, 32);
  return mac === expected ? userId : null;
}
