'use client';

// Вкладка «Мои задачи»: прогресс рендера, история, скачивание final.mp4

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
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';

function TypeIcon({ type, className }: { type: Job['type']; className?: string }) {
  return type === 'long' ? <Hourglass className={className} /> : <Film className={className} />;
}

function statusBadge(status: Job['status']) {
  switch (status) {
    case 'queued':
      return <Badge variant="secondary" className="gap-1 text-[10px]"><Clock className="h-3 w-3" /> В очереди</Badge>;
    case 'processing':
      return <Badge className="gap-1 text-[10px] bg-primary text-primary-foreground"><Loader2 className="h-3 w-3 animate-spin" /> В работе</Badge>;
    case 'completed':
      return <Badge className="gap-1 text-[10px] bg-emerald-600 text-white"><CheckCircle2 className="h-3 w-3" /> Готово</Badge>;
    case 'failed':
      return <Badge variant="destructive" className="gap-1 text-[10px]"><XCircle className="h-3 w-3" /> Ошибка</Badge>;
    default:
      return <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground"><Ban className="h-3 w-3" /> Отменено</Badge>;
  }
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
    <div className="space-y-4 pb-4">
      {/* Активные задачи */}
      {active.length > 0 && (
        <section aria-label="Активные задачи" className="space-y-3">
          <h3 className="text-sm font-semibold flex items-center gap-2">
            На конвейере
            <span className="text-xs font-normal text-muted-foreground">{active.length} активн.</span>
          </h3>
          {active.map((job) => (
            <Card key={job.id} className="overflow-hidden border-primary/30">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center gap-2.5">
                  <div className="h-9 w-9 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
                    <TypeIcon type={job.type} className="h-4.5 w-4.5 text-primary" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{job.sourceName ?? 'Видео'}</p>
                    <p className="text-xs text-muted-foreground">
                      {job.type === 'long' ? 'Long · 1280×720' : 'Short · 1080×1920'} · с {fmtTime(job.createdAt)}
                    </p>
                  </div>
                  {statusBadge(job.status)}
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">{job.stageLabel ?? 'Ожидание слота рендера…'}</span>
                    <span className="font-semibold tabular-nums">{job.progress}%</span>
                  </div>
                  <Progress value={job.progress} className="h-2" />
                </div>

                <div className="flex items-center gap-2 flex-wrap text-[11px] text-muted-foreground">
                  {job.status === 'queued' && job.queuePosition > 0 && (
                    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                      <Clock className="h-3 w-3" /> Позиция в очереди: {job.queuePosition}
                    </span>
                  )}
                  {job.status === 'processing' && job.ramMb && (
                    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                      <MemoryStick className="h-3 w-3" /> ОЗУ воркера: {fmtRam(job.ramMb)} / 12 ГБ
                    </span>
                  )}
                  {job.status === 'processing' && (
                    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
                      <Cpu className="h-3 w-3" /> FIFO · один слот рендера
                    </span>
                  )}
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full h-8 text-xs text-destructive hover:text-destructive"
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
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ListVideo className="h-4 w-4 text-primary" /> История
        </h3>

        {history.length === 0 && active.length === 0 && (
          <div className="rounded-xl border border-dashed border-border py-10 flex flex-col items-center gap-3 text-center px-6">
            <div className="h-12 w-12 rounded-2xl bg-muted flex items-center justify-center">
              <Film className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm font-medium">Пока пусто</p>
            <p className="text-xs text-muted-foreground">
              Закажите монтаж во вкладке Shorts или Long — бот пришлёт готовый final.mp4 сюда и в чат.
            </p>
          </div>
        )}

        {history.map((job) => (
          <Card key={job.id}>
            <CardContent className="p-3.5">
              <div className="flex items-center gap-3">
                <div
                  className="h-14 w-10 rounded-md bg-muted bg-cover bg-center shrink-0 border border-border"
                  style={{ backgroundImage: job.thumbUrl ? `url('${job.thumbUrl}')` : undefined }}
                  role="img"
                  aria-label="Обложка результата"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{job.sourceName ?? 'Видео'}</p>
                  <p className="text-xs text-muted-foreground">
                    {job.type === 'long' ? 'Long' : 'Short'} · {fmtTime(job.createdAt)}
                    {job.resultUrl ? ' · final.mp4' : ''}
                  </p>
                  <div className="mt-1">{statusBadge(job.status)}</div>
                </div>
                {job.status === 'completed' && job.resultUrl && (
                  <a href={job.resultUrl} download={`final_${job.type}_${job.id.slice(0, 6)}.mp4`}>
                    <Button size="sm" className="h-8 gap-1.5 text-xs">
                      <Download className="h-3.5 w-3.5" /> Скачать
                    </Button>
                  </a>
                )}
              </div>
              {job.error && <p className="mt-2 text-xs text-destructive">{job.error}</p>}
              {job.status === 'completed' && (
                <p className="mt-2 text-[11px] text-muted-foreground">
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
