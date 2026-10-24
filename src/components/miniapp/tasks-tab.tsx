'use client';

// Вкладка «Мои задачи»: прогресс рендера, история, скачивание final.mp4.
// Дизайн: стеклянные карточки-капсулы, светящиеся прогресс-бары, iOS-бейджи.

import { useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Clock,
  Cpu,
  Download,
  Film,
  Hourglass,
  ListVideo,
  Loader2,
  MemoryStick,
  XCircle,
} from 'lucide-react';
import { api, fmtRam, fmtTime } from '@/lib/client-api';
import { hapticTap } from '@/lib/telegram-client';
import type { Job } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';

function TypeIcon({ type, className }: { type: Job['type']; className?: string }) {
  return type === 'long' ? <Hourglass className={className} /> : <Film className={className} />;
}

function StatusBadge({ status }: { status: Job['status'] }) {
  const base = 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold';
  switch (status) {
    case 'queued':
      return (
        <span className={`${base} bg-warning/12 text-warning dark:bg-warning/20`}>
          <Clock className="h-3 w-3" /> В очереди
        </span>
      );
    case 'processing':
      return (
        <span className={`${base} bg-primary/12 text-primary dark:bg-primary/25`}>
          <Loader2 className="h-3 w-3 animate-spin" /> В работе
        </span>
      );
    case 'completed':
      return (
        <span className={`${base} bg-success/15 text-success dark:bg-success/20`}>
          <CheckCircle2 className="h-3 w-3" /> Готово
        </span>
      );
    case 'failed':
      return (
        <span className={`${base} bg-destructive/12 text-destructive dark:bg-destructive/25`}>
          <XCircle className="h-3 w-3" /> Ошибка
        </span>
      );
    default:
      return (
        <span className={`${base} bg-black/[0.06] text-muted-foreground dark:bg-white/[0.10]`}>
          <Ban className="h-3 w-3" /> Отменено
        </span>
      );
  }
}

function Chip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.045] px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground dark:bg-white/[0.08]">
      {icon}
      {children}
    </span>
  );
}

export function TasksTab({ jobs }: { jobs: Job[] }) {
  const [cancelling, setCancelling] = useState<string | null>(null);

  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'processing');
  const history = jobs.filter((j) => j.status !== 'queued' && j.status !== 'processing');

  const cancel = async (id: string) => {
    hapticTap();
    setCancelling(id);
    try {
      await api(`/api/jobs/${id}`, { method: 'DELETE' });
      toast({ title: 'Задача отменена', description: 'Слот рендера освобождён' });
    } catch (e) {
      toast({ title: 'Не удалось отменить', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setCancelling(null);
    }
  };

  return (
    <div className="space-y-6 pb-6">
      {/* Заголовок экрана */}
      <div className="space-y-1 px-1">
        <h2 className="text-[26px] font-bold leading-tight tracking-tight">Мои задачи</h2>
        <p className="text-[13px] text-muted-foreground">
          FIFO-очередь рендера: один слот, бережём 12 ГБ ОЗУ сервера
        </p>
      </div>

      {/* Активные задачи */}
      {active.length > 0 && (
        <section aria-label="Активные задачи" className="space-y-3">
          <h3 className="flex items-center gap-2 px-1 text-[15px] font-bold tracking-tight">
            На конвейере
            <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary dark:bg-primary/20">
              {active.length}
            </span>
          </h3>
          {active.map((job) => (
            <Card
              key={job.id}
              className="animate-fade-up gap-0 overflow-hidden border-primary/30 py-4 shadow-[0_2px_16px_rgb(10_132_255/0.10),0_16px_44px_rgb(10_132_255/0.08)] dark:border-primary/40"
            >
              <CardContent className="space-y-3.5 px-4">
                <div className="flex items-center gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 dark:bg-primary/22">
                    <TypeIcon type={job.type} className="h-5 w-5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold">{job.sourceName ?? 'Видео'}</p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {job.type === 'long' ? 'Long · 1280×720' : 'Short · 1080×1920'} · с {fmtTime(job.createdAt)}
                    </p>
                  </div>
                  <StatusBadge status={job.status} />
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-muted-foreground">{job.stageLabel ?? 'Ожидание слота рендера…'}</span>
                    <span className="font-bold tabular-nums text-primary">{job.progress}%</span>
                  </div>
                  <Progress value={job.progress} className="h-2" />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {job.status === 'queued' && job.queuePosition > 0 && (
                    <Chip icon={<Clock className="h-3 w-3" />}>Позиция: {job.queuePosition}</Chip>
                  )}
                  {job.status === 'processing' && job.ramMb && (
                    <Chip icon={<MemoryStick className="h-3 w-3" />}>ОЗУ {fmtRam(job.ramMb)} / 12 ГБ</Chip>
                  )}
                  <Chip icon={<Cpu className="h-3 w-3" />}>FIFO · один слот</Chip>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 w-full text-[12.5px] text-muted-foreground hover:text-destructive"
                  onClick={() => cancel(job.id)}
                  disabled={cancelling === job.id}
                >
                  {cancelling === job.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                  Отменить задачу
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {/* История */}
      <section aria-label="История задач" className="space-y-3">
        <h3 className="flex items-center gap-2 px-1 text-[15px] font-bold tracking-tight">
          <ListVideo className="h-4 w-4 text-primary" />
          История
        </h3>

        {history.length === 0 && active.length === 0 && (
          <div className="flex flex-col items-center gap-3.5 rounded-3xl border border-dashed border-hairline px-8 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-primary/10 dark:bg-primary/18">
              <Film className="h-7 w-7 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="text-[14px] font-semibold">Пока пусто</p>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                Закажите монтаж во вкладке Shorts или Long — бот пришлёт готовый final.mp4 сюда и в чат.
              </p>
            </div>
          </div>
        )}

        {history.map((job) => (
          <Card key={job.id} className="gap-0 py-3.5">
            <CardContent className="px-3.5">
              <div className="flex items-center gap-3">
                <div
                  className="h-[60px] w-11 shrink-0 rounded-2xl border border-hairline bg-muted bg-cover bg-center"
                  style={{ backgroundImage: job.thumbUrl ? `url('${job.thumbUrl}')` : undefined }}
                  role="img"
                  aria-label="Обложка результата"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13.5px] font-semibold">{job.sourceName ?? 'Видео'}</p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {job.type === 'long' ? 'Long' : 'Short'} · {fmtTime(job.createdAt)}
                    {job.resultUrl ? ' · final.mp4' : ''}
                  </p>
                  <div className="mt-1.5">
                    <StatusBadge status={job.status} />
                  </div>
                </div>
                {job.status === 'completed' && job.resultUrl && (
                  <a href={job.resultUrl} download={`final_${job.type}_${job.id.slice(0, 6)}.mp4`}>
                    <Button size="sm" className="h-9 gap-1.5 text-[12.5px]">
                      <Download className="h-3.5 w-3.5" /> Скачать
                    </Button>
                  </a>
                )}
              </div>
              {job.error && <p className="mt-2.5 text-[12px] font-medium text-destructive">{job.error}</p>}
              {job.status === 'completed' && (
                <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  Файл отправлен ботом в чат и продублирован ссылкой. Временные файлы удалены.
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </section>
    </div>
  );
}
