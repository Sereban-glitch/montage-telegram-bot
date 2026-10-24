'use client';

// Вкладка «Витрина»: галерея готовых работ движка с предпросмотром

import { useState } from 'react';
import { BadgeCheck, Eye, Play, Star } from 'lucide-react';
import { fmtDuration, fmtViews } from '@/lib/client-api';
import { hapticTap } from '@/lib/telegram-client';
import type { ShowcaseItem } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
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
    <div className="space-y-5 pb-4">
      {/* Баннер витрины */}
      <div className="relative overflow-hidden rounded-2xl border border-border">
        <div
          className="absolute inset-0 bg-cover"
          style={{ backgroundImage: "url('/showcase/banner.png')" }}
          aria-hidden
        />
        <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/55 to-transparent" aria-hidden />
        <div className="relative p-5 py-7">
          <h2 className="text-white text-lg font-bold">Витрина работ</h2>
          <p className="text-white/75 text-xs mt-1 max-w-[75%]">
            Реальные примеры: нарезки по КСУ, заседания суда, лекции. Всё смонтировано движком автоматически.
          </p>
        </div>
      </div>

      {/* Shorts */}
      {shorts.length > 0 && (
        <section aria-label="Примеры Shorts">
          <h3 className="text-sm font-semibold mb-2.5 flex items-center gap-2">
            Shorts · вертикаль 1080×1920
            <Badge variant="secondary" className="text-[10px]">{shorts.length}</Badge>
          </h3>
          <div className="grid grid-cols-2 gap-3">
            {shorts.map((item) => (
              <button
                key={item.id}
                onClick={() => openItem(item)}
                className="group relative overflow-hidden rounded-xl border border-border aspect-[9/16] text-left focus-visible:ring-2 focus-visible:ring-ring outline-none"
              >
                <div className="absolute inset-0 bg-cover transition-transform duration-300 group-hover:scale-[1.04]" style={{ backgroundImage: `url('${item.thumbUrl}')` }} />
                <div className="absolute inset-0 thumb-scrim" />
                <div className="absolute top-2 left-2">
                  <Badge className="bg-primary/90 text-primary-foreground text-[9px] px-1.5 py-0">Short</Badge>
                </div>
                {item.featured && (
                  <div className="absolute top-2 right-2 text-amber-400">
                    <Star className="h-4 w-4 fill-current" />
                  </div>
                )}
                <div className="absolute bottom-0 inset-x-0 p-2.5">
                  <p className="text-white text-[11px] font-semibold leading-snug line-clamp-2">{item.title}</p>
                  <div className="flex items-center gap-2 mt-1 text-white/70 text-[10px]">
                    <span className="flex items-center gap-0.5"><Play className="h-3 w-3" />{fmtDuration(item.durationSec)}</span>
                    <span className="flex items-center gap-0.5"><Eye className="h-3 w-3" />{fmtViews(item.views)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Long */}
      {longs.length > 0 && (
        <section aria-label="Примеры длинных видео">
          <h3 className="text-sm font-semibold mb-2.5 flex items-center gap-2">
            Long · 1280×720 с субтитрами
            <Badge variant="secondary" className="text-[10px]">{longs.length}</Badge>
          </h3>
          <div className="space-y-3">
            {longs.map((item) => (
              <button
                key={item.id}
                onClick={() => openItem(item)}
                className="group relative w-full overflow-hidden rounded-xl border border-border aspect-video text-left focus-visible:ring-2 focus-visible:ring-ring outline-none"
              >
                <div className="absolute inset-0 bg-cover transition-transform duration-300 group-hover:scale-[1.03]" style={{ backgroundImage: `url('${item.thumbUrl}')` }} />
                <div className="absolute inset-0 thumb-scrim" />
                <div className="absolute top-2 left-2">
                  <Badge variant="secondary" className="text-[9px] px-1.5 py-0 bg-black/60 text-white border-0">Long</Badge>
                </div>
                <div className="absolute bottom-0 inset-x-0 p-3">
                  <p className="text-white text-sm font-semibold leading-snug line-clamp-1">{item.title}</p>
                  {item.subtitle && <p className="text-white/70 text-[11px] line-clamp-1 mt-0.5">{item.subtitle}</p>}
                  <div className="flex items-center gap-3 mt-1.5 text-white/70 text-[10px]">
                    <span className="flex items-center gap-1"><Play className="h-3 w-3" />{fmtDuration(item.durationSec)}</span>
                    <span className="flex items-center gap-1"><Eye className="h-3 w-3" />{fmtViews(item.views)}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Диалог предпросмотра */}
      <Dialog open={Boolean(open)} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-[92vw] sm:max-w-md p-4 gap-3">
          {open && (
            <>
              <DialogHeader className="space-y-1 text-left">
                <DialogTitle className="text-base leading-snug pr-4">{open.title}</DialogTitle>
                <DialogDescription className="text-xs">
                  {open.subtitle ?? 'Пример работы движка Sereban-glitch-video-montage'}
                </DialogDescription>
              </DialogHeader>
              {open.videoUrl ? (
                <video
                  key={open.id}
                  src={open.videoUrl}
                  controls
                  playsInline
                  className={`w-full rounded-lg border border-border bg-black ${open.kind === 'short' ? 'max-h-[52vh] mx-auto aspect-[9/16]' : 'aspect-video'}`}
                />
              ) : (
                <div className="w-full aspect-video rounded-lg border border-border bg-cover" style={{ backgroundImage: `url('${open.thumbUrl}')` }} />
              )}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <BadgeCheck className="h-4 w-4 text-primary" />
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
