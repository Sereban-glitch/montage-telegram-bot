'use client';

// Вкладка «Витрина»: галерея готовых работ движка с предпросмотром.
// Дизайн: премиальные постеры с градиентным наложением и синей кнопкой Play.

import { useState } from 'react';
import { BadgeCheck, Eye, Play, Sparkles, Star } from 'lucide-react';
import { fmtDuration, fmtViews } from '@/lib/client-api';
import { hapticTap } from '@/lib/telegram-client';
import type { ShowcaseItem } from '@/lib/types';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function ShowcaseTab({ items, reload }: { items: ShowcaseItem[]; reload: () => void }) {
  const [open, setOpen] = useState<ShowcaseItem | null>(null);
  const shorts = items.filter((i) => i.kind === 'short');
  const longs = items.filter((i) => i.kind === 'long');

  const openItem = (item: ShowcaseItem) => {
    hapticTap();
    setOpen(item);
    // счётчик просмотров — без блокировки UI
    fetch('/api/showcase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id }),
    })
      .then(() => reload())
      .catch(() => undefined);
  };

  return (
    <div className="space-y-7 pb-6">
      {/* Заголовок экрана */}
      <div className="space-y-1 px-1">
        <h2 className="text-[26px] font-bold leading-tight tracking-tight">Витрина</h2>
        <p className="text-[13px] text-muted-foreground">
          Смонтировано движком автоматически: нарезки по КСУ, заседания, лекции
        </p>
      </div>

      {/* Баннер-постер */}
      <div className="relative overflow-hidden rounded-3xl shadow-float ring-1 ring-black/10 dark:ring-white/15">
        <div
          className="absolute inset-0 bg-cover"
          style={{ backgroundImage: "url('/showcase/banner.png')" }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-black/5" aria-hidden />
        <div className="relative p-6 py-9">
          <span className="mb-2 inline-flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/90 backdrop-blur-md">
            <Sparkles className="h-3 w-3" /> Автоматический монтаж
          </span>
          <h3 className="text-[22px] font-bold leading-tight tracking-tight text-white">
            Работы «Монтажной Кухни»
          </h3>
          <p className="mt-1 max-w-[80%] text-[12px] leading-relaxed text-white/80">
            Реальные примеры: Shorts из суда, нарезки по КСУ, длинные заседания с главами.
          </p>
        </div>
      </div>

      {/* Shorts */}
      {shorts.length > 0 && (
        <section aria-label="Примеры Shorts" className="space-y-3">
          <h3 className="flex items-center gap-2 px-1 text-[15px] font-bold tracking-tight">
            Shorts · вертикаль
            <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary dark:bg-primary/20">
              {shorts.length}
            </span>
          </h3>
          <div className="grid grid-cols-2 gap-3.5">
            {shorts.map((item) => (
              <button
                key={item.id}
                onClick={() => openItem(item)}
                className="tap-none group relative aspect-[9/16] overflow-hidden rounded-3xl text-left shadow-soft ring-1 ring-black/10 outline-none transition-all duration-300 hover:shadow-float focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.96] dark:ring-white/15"
              >
                <div
                  className="absolute inset-0 bg-cover transition-transform duration-500 group-hover:scale-[1.06]"
                  style={{ backgroundImage: `url('${item.thumbUrl}')` }}
                />
                <div className="absolute inset-0 thumb-scrim" />

                {/* Бейдж формата */}
                <div className="absolute top-2.5 left-2.5">
                  <span className="rounded-full bg-primary/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white backdrop-blur-sm">
                    Short
                  </span>
                </div>
                {item.featured && (
                  <div className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/30 backdrop-blur-md">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  </div>
                )}

                {/* Кнопка воспроизведения — проявляется на hover */}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 group-hover:opacity-100">
                  <span className="flex h-12 w-12 scale-90 items-center justify-center rounded-full bg-primary/85 shadow-glow backdrop-blur-md transition-transform duration-300 group-hover:scale-100">
                    <Play className="ml-0.5 h-5 w-5 fill-white text-white" />
                  </span>
                </div>

                <div className="absolute inset-x-0 bottom-0 p-3">
                  <p className="line-clamp-2 text-[11.5px] font-semibold leading-snug text-white">
                    {item.title}
                  </p>
                  <div className="mt-1 flex items-center gap-2 text-[10px] text-white/75">
                    <span className="flex items-center gap-0.5"><Play className="h-2.5 w-2.5" />{fmtDuration(item.durationSec)}</span>
                    <span className="flex items-center gap-0.5"><Eye className="h-2.5 w-2.5" />{fmtViews(item.views)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Long */}
      {longs.length > 0 && (
        <section aria-label="Примеры длинных видео" className="space-y-3">
          <h3 className="flex items-center gap-2 px-1 text-[15px] font-bold tracking-tight">
            Long · 1280×720
            <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary dark:bg-primary/20">
              {longs.length}
            </span>
          </h3>
          <div className="space-y-3.5">
            {longs.map((item) => (
              <button
                key={item.id}
                onClick={() => openItem(item)}
                className="tap-none group relative w-full overflow-hidden rounded-3xl text-left shadow-soft ring-1 ring-black/10 outline-none transition-all duration-300 hover:shadow-float focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98] dark:ring-white/15"
              >
                <div
                  className="absolute inset-0 bg-cover transition-transform duration-500 group-hover:scale-[1.04]"
                  style={{ backgroundImage: `url('${item.thumbUrl}')` }}
                />
                <div className="absolute inset-0 thumb-scrim" />
                <div className="absolute top-2.5 left-2.5">
                  <span className="rounded-full bg-black/45 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white backdrop-blur-md">
                    Long
                  </span>
                </div>
                {item.featured && (
                  <div className="absolute top-2 right-2 flex h-6 w-6 items-center justify-center rounded-full bg-black/30 backdrop-blur-md">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 group-hover:opacity-100">
                  <span className="flex h-14 w-14 scale-90 items-center justify-center rounded-full bg-primary/85 shadow-glow backdrop-blur-md transition-transform duration-300 group-hover:scale-100">
                    <Play className="ml-0.5 h-6 w-6 fill-white text-white" />
                  </span>
                </div>
                <div className="absolute inset-x-0 bottom-0 p-4">
                  <p className="line-clamp-1 text-[14px] font-semibold leading-snug text-white">{item.title}</p>
                  {item.subtitle && (
                    <p className="mt-0.5 line-clamp-1 text-[11.5px] text-white/75">{item.subtitle}</p>
                  )}
                  <div className="mt-1.5 flex items-center gap-3 text-[10px] text-white/75">
                    <span className="flex items-center gap-1"><Play className="h-2.5 w-2.5" />{fmtDuration(item.durationSec)}</span>
                    <span className="flex items-center gap-1"><Eye className="h-2.5 w-2.5" />{fmtViews(item.views)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Диалог предпросмотра */}
      <Dialog open={Boolean(open)} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-[92vw] gap-3 rounded-3xl p-4 sm:max-w-md">
          {open && (
            <>
              <DialogHeader className="space-y-1 text-left">
                <DialogTitle className="pr-4 text-[16px] leading-snug tracking-tight">{open.title}</DialogTitle>
                <DialogDescription className="text-[12px]">
                  {open.subtitle ?? 'Пример работы движка Sereban-glitch-video-montage'}
                </DialogDescription>
              </DialogHeader>
              {open.videoUrl ? (
                <video
                  key={open.id}
                  src={open.videoUrl}
                  controls
                  playsInline
                  className={`w-full rounded-2xl bg-black ring-1 ring-black/10 dark:ring-white/10 ${open.kind === 'short' ? 'mx-auto aspect-[9/16] max-h-[52vh]' : 'aspect-video'}`}
                />
              ) : (
                <div
                  className="aspect-video w-full rounded-2xl bg-cover ring-1 ring-black/10 dark:ring-white/10"
                  style={{ backgroundImage: `url('${open.thumbUrl}')` }}
                />
              )}
              <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                <BadgeCheck className="h-4 w-4 shrink-0 text-primary" />
                Смонтировано автоматически: субтитры, обложка, EBU R128
                {open.kind === 'long' && ' · вырезаны паузы'}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
