'use client';

// Общий селектор целевой длительности готовых роликов (вкладки «ИИ-хуки» и «Shorts»).
// Отзыв владельца: «Почему 25–55 секунд, если Shorts в YouTube уже до 3 минут?».
// YouTube Shorts с 15.10.2024 официально разрешает вертикальные видео до 180 сек —
// для судов и разборов классических 45 сек часто мало. Пресеты синхронны
// с DURATION_PRESETS в services/worker/app/hook_scorer.py.

import { Check } from 'lucide-react';
import { hapticTap } from '@/lib/telegram-client';
import { useI18n } from '@/lib/i18n';

export type TargetDuration = 'short' | 'standard' | 'deep';

const OPTIONS: {
  key: TargetDuration;
  titleKey: 'short' | 'standard' | 'deep';
  hintKey: 'shortHint' | 'standardHint' | 'deepHint';
}[] = [
  { key: 'short', titleKey: 'short', hintKey: 'shortHint' },
  { key: 'standard', titleKey: 'standard', hintKey: 'standardHint' },
  { key: 'deep', titleKey: 'deep', hintKey: 'deepHint' },
];

export function DurationPicker({
  value,
  onChange,
  label,
}: {
  value: TargetDuration;
  onChange: (v: TargetDuration) => void;
  label: string;
}) {
  const { t } = useI18n();
  return (
    <section aria-label={label} className="rounded-3xl border border-hairline bg-card p-4 shadow-soft">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="grid gap-1.5 sm:grid-cols-3">
        {OPTIONS.map(({ key, titleKey, hintKey }) => {
          const active = value === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => {
                if (!active) {
                  hapticTap();
                  onChange(key);
                }
              }}
              aria-pressed={active}
              className={`tap-none flex items-center justify-between gap-2 rounded-2xl border px-3 py-2.5 text-left transition-all duration-200 active:scale-[0.98] ${
                active
                  ? 'border-primary/60 bg-primary/[0.08] shadow-soft dark:bg-primary/[0.16]'
                  : 'border-hairline hover:border-primary/35'
              }`}
            >
              <span className="min-w-0">
                <span className={`block text-[13px] font-semibold leading-tight ${active ? 'text-primary' : ''}`}>
                  {t.dur[titleKey]}
                </span>
                <span className="mt-0.5 block text-[10.5px] leading-snug text-muted-foreground">
                  {t.dur[hintKey]}
                </span>
              </span>
              <span
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-all duration-200 ${
                  active ? 'border-primary bg-primary text-white' : 'border-hairline text-transparent'
                }`}
              >
                <Check className="h-3 w-3" strokeWidth={3} />
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
