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
  ready: () => void;
  expand: () => void;
  close: () => void;
  disableVerticalSwipes?: () => void;
  requestFullscreen?: () => void;
  exitFullscreen?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
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

export function hapticTap() {
  try {
    getTg()?.HapticFeedback?.impactOccurred('light');
  } catch {
    /* вне Telegram — тихо игнорируем */
  }
}

export function hapticSuccess() {
  try {
    getTg()?.HapticFeedback?.notificationOccurred('success');
  } catch {
    /* noop */
  }
}
