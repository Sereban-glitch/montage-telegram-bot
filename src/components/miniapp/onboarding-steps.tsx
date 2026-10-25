'use client';

// Закреплённый онбординг-блок «3 шага» — ПЕРСОНАЛЬНЫЙ для каждой вкладки.
// Отзыв владельца: одинаковые шаги «ИИ выберет 3 самых мощных момента» во всех
// вкладках вводили в заблуждение (Shorts и Long НЕ выдают 3 ролика!).
// Теперь у hooks / shorts / long свои честные шаги.
// Можно свернуть (крестик) — выбор сохраняется в localStorage.

import { useEffect, useSyncExternalStore } from 'react';
import { X } from 'lucide-react';
import { hapticTap } from '@/lib/telegram-client';
import { ONBOARDING_STORAGE_KEY, useI18n } from '@/lib/i18n';

// Вкладки с онбордингом (Витрина/Задачи — без него)
export type OnboardingTab = 'hooks' | 'shorts' | 'long';

// Иконки шагов под каждый режим: ссылка → ИИ → результат
const STEP_ICONS: Record<OnboardingTab, readonly [string, string, string]> = {
  hooks: ['🔗', '🧠', '🎬'],
  shorts: ['📂', '🎨', '📲'],
  long: ['📂', '✂️', '📥'],
};

// ── Мини-стор флага «свернуто» ──────────────────────────────
// React 19 / eslint: setState в теле эффекта запрещён — используем внешний стор.
// До монтирования скрыт (SSR-безопасно), затем раскрывается с анимацией.

let obHidden = true;
const obListeners = new Set<() => void>();
let obInitialized = false;

function initOnboarding() {
  if (obInitialized) return;
  obInitialized = true;
  let hidden = false;
  try {
    hidden = localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1';
  } catch {
    hidden = false;
  }
  if (hidden !== obHidden) {
    obHidden = hidden;
    obListeners.forEach((cb) => cb());
  }
}

function dismissOnboarding() {
  obHidden = true;
  try {
    localStorage.setItem(ONBOARDING_STORAGE_KEY, '1');
  } catch {
    /* noop */
  }
  obListeners.forEach((cb) => cb());
}

function useOnboardingHidden(): boolean {
  useEffect(() => {
    initOnboarding();
  }, []);
  return useSyncExternalStore(
    (cb) => {
      obListeners.add(cb);
      return () => {
        obListeners.delete(cb);
      };
    },
    () => obHidden,
    () => true,
  );
}

export function OnboardingSteps({ tab }: { tab: OnboardingTab }) {
  const { t } = useI18n();
  const hidden = useOnboardingHidden();

  if (hidden) return null;

  const dismiss = () => {
    hapticTap();
    dismissOnboarding();
  };

  const ob = t.onboarding.tabs[tab];
  const steps = ob.steps;
  const icons = STEP_ICONS[tab];

  return (
    <section
      aria-label={ob.title}
      className="animate-fade-up relative overflow-hidden rounded-3xl border border-primary/20 bg-gradient-to-b from-primary/[0.08] to-primary/[0.03] p-4 shadow-soft dark:border-primary/30 dark:from-primary/[0.14] dark:to-primary/[0.06]"
    >
      <button
        type="button"
        onClick={dismiss}
        aria-label={t.onboarding.dismiss}
        className="absolute top-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/[0.04] text-muted-foreground transition-colors hover:bg-black/[0.08] hover:text-foreground dark:bg-white/[0.08] dark:hover:bg-white/[0.14]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
      <p className="mb-2.5 pr-8 text-[11px] font-semibold uppercase tracking-[0.07em] text-primary">
        {ob.title}
      </p>
      <ol className="space-y-2.5">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-white shadow-sm">
              {i + 1}
            </span>
            <span className="min-w-0 pt-0.5 text-[13px] leading-snug">
              <span aria-hidden className="mr-1">
                {icons[i]}
              </span>
              {step}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
