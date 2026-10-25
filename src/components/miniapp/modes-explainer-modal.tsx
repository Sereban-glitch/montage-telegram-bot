'use client';

// Модалка «ℹ️ Шпаргалка: как работают 3 режима» — прямой ответ на отзыв владельца:
// «он мне каждый раз даёт только одно видео, а не три коротких шортса!».
// Кристально разделяет конвейеры: ИИ-хуки (3 готовых Shorts НА ВЫБОР) vs
// Монтаж Shorts (ОДИН вертикальный ролик) vs Монтаж Long (горизонтальное видео).
// Вызывается из кнопки ℹ️ в шапке — доступна в любой момент.

import { ArrowRight, CircleCheck, Lightbulb } from 'lucide-react';
import { hapticTap } from '@/lib/telegram-client';
import { useI18n } from '@/lib/i18n';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

/** Одна строка сравнительной таблицы: режим → источник → результат → кому. */
function ModeRow({
  mode,
  source,
  result,
  audience,
  accent,
}: {
  mode: string;
  source: string;
  result: string;
  audience: string;
  accent: string;
}) {
  const { t } = useI18n();
  return (
    <div className="rounded-2xl border border-hairline bg-card/70 p-3.5 shadow-soft">
      <p className={`text-[14px] font-bold leading-snug ${accent}`}>{mode}</p>
      <dl className="mt-2 space-y-1.5 text-[12.5px] leading-snug">
        <div className="flex items-start gap-1.5">
          <dt className="shrink-0 rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground dark:bg-white/[0.09]">
            {t.modes.source}
          </dt>
          <dd className="min-w-0 pt-0.5 text-muted-foreground">{source}</dd>
        </div>
        <div className="flex items-start gap-1.5">
          <dt className="shrink-0 rounded-md bg-primary/12 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary dark:bg-primary/25">
            {t.modes.result}
          </dt>
          <dd className="min-w-0 pt-0.5 font-medium text-foreground">
            <ArrowRight className="mr-1 inline h-3 w-3 text-primary" aria-hidden />
            {result}
          </dd>
        </div>
        <div className="flex items-start gap-1.5">
          <dt className="shrink-0 rounded-md bg-black/[0.05] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground dark:bg-white/[0.09]">
            {t.modes.audience}
          </dt>
          <dd className="min-w-0 pt-0.5 text-muted-foreground">{audience}</dd>
        </div>
      </dl>
    </div>
  );
}

export function ModesExplainerModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { t } = useI18n();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[94vw] gap-3 rounded-3xl p-4 sm:max-w-md">
        <DialogHeader className="space-y-1.5 text-left">
          <DialogTitle className="text-[17px] leading-snug tracking-tight">
            {t.modes.title}
          </DialogTitle>
          <DialogDescription className="text-[12.5px] leading-snug">
            {t.modes.intro}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2.5" role="table" aria-label={t.modes.title}>
          <ModeRow
            mode={t.modes.hooksMode}
            source={t.modes.hooksSource}
            result={t.modes.hooksResult}
            audience={t.modes.hooksAudience}
            accent="text-[#ff9f0a]"
          />
          <ModeRow
            mode={t.modes.shortsMode}
            source={t.modes.shortsSource}
            result={t.modes.shortsResult}
            audience={t.modes.shortsAudience}
            accent="text-[#ff375f]"
          />
          <ModeRow
            mode={t.modes.longMode}
            source={t.modes.longSource}
            result={t.modes.longResult}
            audience={t.modes.longAudience}
            accent="text-[#0a84ff]"
          />
        </div>

        <p className="flex items-start gap-2 rounded-2xl bg-primary/[0.07] px-3 py-2.5 text-[12px] leading-snug text-muted-foreground dark:bg-primary/[0.14]">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
          {t.modes.tip}
        </p>

        <Button
          size="lg"
          className="h-11 w-full rounded-2xl text-[13.5px] font-semibold"
          onClick={() => {
            hapticTap();
            onOpenChange(false);
          }}
        >
          <CircleCheck className="h-4.5 w-4.5" aria-hidden />
          {t.modes.gotIt}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
