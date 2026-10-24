// Клиентский API-слой: относительные пути, JSON, ошибки по-русски

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `Ошибка запроса (${res.status})`);
  }
  return data as T;
}

export function fmtDuration(sec: number | null | undefined): string {
  if (!sec && sec !== 0) return '';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function fmtRam(mb: number | null | undefined): string {
  if (!mb) return '';
  return `${(mb / 1024).toFixed(1)} ГБ`;
}

export function fmtViews(views: number): string {
  if (views >= 1000) return `${(views / 1000).toFixed(1)}K`;
  return String(views);
}

// Псевдо-кадры для выбора обложки: таймкоды по длине видео
export function frameTimecodes(count: number, durationSec: number): string[] {
  return Array.from({ length: count }, (_, i) => {
    const t = Math.round((durationSec / count) * i + durationSec * 0.05);
    return fmtDuration(t);
  });
}

export const STATUS_LABEL: Record<string, string> = {
  queued: 'В очереди',
  processing: 'В работе',
  completed: 'Готово',
  failed: 'Ошибка',
  cancelled: 'Отменено',
};
