'use client';

// Минимальная обёртка над Telegram WebApp SDK.
// В браузере (песочница) getTg() вернёт null — включается демо-режим.

export type TgThemeParams = {
  bg_color?: string;
  text_color?: string;
  hint_color?: string;
  button_color?: string;
};

export type TgWebApp = {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; username?: string; photo_url?: string } };
  colorScheme: 'light' | 'dark';
  themeParams: TgThemeParams;
  /** Платформа клиента: ios | android | tdesktop | macos | web | webk | unigram | unknown */
  platform?: string;
  /** Версия Bot API у клиента, например '8.0' */
  version?: string;
  ready: () => void;
  expand: () => void;
  close: () => void;
  disableVerticalSwipes?: () => void;
  requestFullscreen?: () => void;
  exitFullscreen?: () => void;
  /** Актуальное состояние fullscreen (Bot API 8.0+) */
  isFullscreen?: boolean;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  /** Подписка на события WebApp: fullscreenChanged, exitFullscreenRequested и др. */
  onEvent?: (eventType: string, eventHandler: () => void) => void;
  offEvent?: (eventType: string, eventHandler: () => void) => void;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  };
};

// Платформы десктопного Telegram — триггерят desktop-раскладку и полноэкранный режим.
export const TG_DESKTOP_PLATFORMS: readonly string[] = ['tdesktop', 'macos', 'web', 'webk'];

export function tgPlatform(): string {
  return getTg()?.platform ?? '';
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export function getTg(): TgWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp?.initData !== undefined ? (window.Telegram.WebApp as TgWebApp) : null;
}

export function tgInitData(): string | null {
  const tg = getTg();
  return tg?.initData || null;
}

/** Версия Bot API у клиента (например 8.0); 0 — неизвестна. */
export function tgVersion(): number {
  const raw = getTg()?.version;
  if (!raw) return 0;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

/** Полноэкранный режим доступен начиная с Bot API 8.0. */
function nativeFullscreenAvailable(): boolean {
  const tg = getTg();
  if (!tg?.requestFullscreen) return false;
  const ver = tgVersion();
  // Версия неизвестна (0) — пробуем: SDK старых версий просто не содержит метод.
  return ver === 0 || ver >= 8;
}

// Telegram-события смены полноэкранного режима (Bot API 8.0+)
export const TG_FS_EVENTS = {
  changed: 'fullscreenChanged',
  exitRequested: 'exitFullscreenRequested',
} as const;

/**
 * Переключение полноэкранного режима окна.
 * 1) нативный requestFullscreen/exitFullscreen Telegram (мобильные + Telegram Desktop);
 * 2) браузерный fullscreen API как запасной путь (песочница / web-клиенты без нативного метода).
 * Возвращает фактическое состояние после попытки (или null, если определить нельзя).
 */
export async function toggleFullscreen(): Promise<boolean | null> {
  const tg = getTg();
  try {
    if (nativeFullscreenAvailable() && tg?.exitFullscreen) {
      if (tg.isFullscreen) {
        tg.exitFullscreen();
        return false;
      }
      await tg.requestFullscreen?.();
      return true;
    }
  } catch {
    /* нативный путь недоступен — пробуем браузерный */
  }
  // Браузерный запасной вариант (вне Telegram, Telegram Web)
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return false;
    }
    await document.documentElement.requestFullscreen();
    return true;
  } catch {
    return null;
  }
}

/** Подписка на смену fullscreen (Telegram-события + браузерный fallback). Возвращает функцию отписки. */
export function onFullscreenChange(cb: (isFullscreen: boolean) => void): () => void {
  const tg = getTg();
  const tgOn = () => cb(true);
  const tgOff = () => cb(false);
  try {
    tg?.onEvent?.(TG_FS_EVENTS.changed, tgOn);
    tg?.onEvent?.(TG_FS_EVENTS.exitRequested, tgOff);
  } catch {
    /* события недоступны */
  }
  const docOn = () => cb(Boolean(document.fullscreenElement));
  document.addEventListener('fullscreenchange', docOn);
  return () => {
    try {
      tg?.offEvent?.(TG_FS_EVENTS.changed, tgOn);
      tg?.offEvent?.(TG_FS_EVENTS.exitRequested, tgOff);
    } catch {
      /* noop */
    }
    document.removeEventListener('fullscreenchange', docOn);
  };
}

export function hapticTap() {
  try {
    getTg()?.HapticFeedback?.impactOccurred('light');
  } catch {
    /* вне Telegram — тихо игнорируем */
  }
}

/** Авто-fullscreen при старте: нативный Telegram (Bot API 8.0+), в песочнице — тихо выходим. */
export function requestAutoFullscreen() {
  if (!nativeFullscreenAvailable()) return;
  try {
    getTg()?.requestFullscreen?.();
  } catch {
    /* платформа не поддерживает — молча продолжаем */
  }
}

export function hapticSuccess() {
  try {
    getTg()?.HapticFeedback?.notificationOccurred('success');
  } catch {
    /* noop */
  }
}
