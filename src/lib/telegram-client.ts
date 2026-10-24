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
  platform?: string;
  isExpanded?: boolean;
  ready: () => void;
  expand: () => void;
  close: () => void;
  requestFullscreen?: () => void;
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (color: string) => void;
  setBackgroundColor?: (color: string) => void;
  HapticFeedback?: {
    impactOccurred: (style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft') => void;
    notificationOccurred: (type: 'error' | 'success' | 'warning') => void;
  };
};

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export function getTg(): TgWebApp | null {
  if (typeof window === 'undefined') return null;
  return window.Telegram?.WebApp ? (window.Telegram.WebApp as TgWebApp) : null;
}

export function isTgDesktop(): boolean {
  const tg = getTg();
  const platform = (tg?.platform || '').toLowerCase();
  return ['tdesktop', 'macos', 'web', 'webk', 'weba'].includes(platform) || (typeof window !== 'undefined' && window.innerWidth >= 768);
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
