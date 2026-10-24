'use client';

// Нативный сегментированный контрол iOS (как в Settings / App Store):
// пилюля-подложка + белый «бегунок» активного сегмента с мягкой тенью.

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

export function Segmented<T extends string>({
  value,
  onValueChange,
  options,
  className,
  ariaLabel,
}: {
  value: T;
  onValueChange: (v: T) => void;
  options: SegmentedOption<T>[];
  className?: string;
  ariaLabel?: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'flex items-stretch gap-1 rounded-full bg-black/[0.055] p-1 dark:bg-white/[0.09]',
        className,
      )}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onValueChange(o.value)}
            className={cn(
              'tap-none flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-medium outline-none transition-all duration-200 min-h-[34px]',
              'focus-visible:ring-2 focus-visible:ring-ring/40',
              active
                ? 'bg-card text-foreground shadow-[0_1px_4px_rgb(0_0_0/0.14),0_0_0_0.5px_rgb(0_0_0/0.04)] dark:bg-[#5a5a5f] dark:text-white dark:shadow-none'
                : 'text-muted-foreground hover:text-foreground active:bg-black/[0.04] dark:active:bg-white/[0.06]',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
