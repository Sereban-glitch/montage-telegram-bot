'use client';

// Вкладка «Мои задачи»: прогресс рендера, история, скачивание final.mp4.
// Дизайн: стеклянные карточки-капсулы, светящиеся прогресс-бары, iOS-бейджи.
// Отзыв владельца (job_372d0282ed65): пустые названия при sourceName === "",
// битые превью-картинки 404, нет кнопки «Открыть хуки» для анализа.

import { useState } from 'react';
import {
  Ban,
  CheckCircle2,
  Clock,
  Crosshair,
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
import { useI18n } from '@/lib/i18n';
import type { Job, JobType } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { toast } from '@/hooks/use-toast';

function TypeIcon({ type, className }: { type: Job['type']; className?: string }) {
  if (type === 'long') return <Hourglass className={className} />;
  if (type === 'hook_analysis') return <Crosshair className={className} />;
  return <Film className={className} />;
}

function Chip({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-black/[0.045] px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground dark:bg-white/[0.08]">
      {icon}
      {children}
    </span>
  );
}

// Человекочитаемый тип задачи (вместо «Short» для анализа хуков)
function typeLabel(type: JobType, t: ReturnType<typeof useI18n>['t']): string {
  if (type === 'long') return t.tasks.typeLong;
  if (type === 'hook_analysis') return t.tasks.typeHookAnalysis;
  if (type === 'hook_render') return t.tasks.typeHookRender;
  return t.tasks.typeShort;
}

// ── Векторная заглушка формата (вместо битых /showcase/job_....png → 404) ──
// 9:16 Shorts — розово-фиолетовый градиент с вертикальным кадром;
// 16:9 Long — сине-фиолетовый с горизонтальным кадром;
// 🎯 Анализ хуков — оранжевый с мишенью.
function FormatThumb({ job }: { job: Job }) {
  const { t } = useI18n();
  const [imgOk, setImgOk] = useState(true);
  const isShort = job.type !== 'long';
  const gradient = isShort
    ? 'from-[#ff375f] to-[#bf5af2]'
    : 'from-[#0a84ff] to-[#5e5ce6]';
  const showImg = Boolean(job.thumbUrl) && imgOk;

  return (
    <div
      className={`relative h-[60px] w-11 shrink-0 overflow-hidden rounded-2xl shadow-soft ${
        showImg ? '' : `bg-gradient-to-b ${gradient}`
      }`}
      role="img"
      aria-label={typeLabel(job.type, t)}
    >
      {showImg ? (
        <img
          src={job.thumbUrl ?? undefined}
          alt=""
          className="absolute inset-0 h-full w-full object-cover"
          onError={() => setImgOk(false)}
        />
      ) : job.type === 'hook_analysis' ? (
        // 🎯 мишень: оранжевый градиент + концентрические круги
        <svg viewBox="0 0 44 60" className="absolute inset-0 h-full w-full" aria-hidden>
          <circle cx="22" cy="30" r="15" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="2" />
          <circle cx="22" cy="30" r="9" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2" />
          <circle cx="22" cy="30" r="3.2" fill="rgba(255,255,255,0.9)" />
        </svg>
      ) : isShort ? (
        // 9:16 вертикальный кадр
        <svg viewBox="0 0 44 60" className="absolute inset-0 h-full w-full" aria-hidden>
          <rect x="11" y="9" width="22" height="42" rx="4" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2.4" />
          <path d="M19.5 25.5 27 30l-7.5 4.5z" fill="rgba(255,255,255,0.9)" />
        </svg>
      ) : (
        // 16:9 горизонтальный кадр
        <svg viewBox="0 0 44 60" className="absolute inset-0 h-full w-full" aria-hidden>
          <rect x="5" y="20" width="34" height="20" rx="3.5" fill="none" stroke="rgba(255,255,255,0.85)" strokeWidth="2.4" />
          <path d="M20 26.5 26.5 30 20 33.5z" fill="rgba(255,255,255,0.9)" />
        </svg>
      )}
    </div>
  );
}

export function TasksTab({ jobs, onNavigate }: { jobs: Job[]; onNavigate?: (tab: 'hooks' | 'shorts' | 'long' | 'showcase' | 'tasks') => void }) {
  const { t } = useI18n();
  const [cancelling, setCancelling] = useState<string | null>(null);

  const active = jobs.filter((j) => j.status === 'queued' || j.status === 'processing');
  const history = jobs.filter((j) => j.status !== 'queued' && j.status !== 'processing');

  // ✅ Фикс владельца: пустая строка "" больше не даёт пустой заголовок
  const jobName = (job: Job) => job.sourceName?.trim() || t.tasks.video;

  const statusText: Record<Job['status'], string> = {
    queued: t.tasks.stQueued,
    processing: t.tasks.stProcessing,
    completed: t.tasks.stCompleted,
    failed: t.tasks.stFailed,
    cancelled: t.tasks.stCancelled,
  };

  const cancel = async (id: string) => {
    hapticTap();
    setCancelling(id);
    try {
      await api(`/api/jobs/${id}`, { method: 'DELETE' });
      toast({ title: t.tasks.cancelTitle, description: t.tasks.cancelDesc });
    } catch (e) {
      toast({
        title: t.tasks.cancelFail,
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setCancelling(null);
    }
  };

  // 🎯 Для завершённого анализа хуков — переход к карточкам кандидатов
  const openHooks = () => {
    hapticTap();
    onNavigate?.('hooks');
  };

  return (
    <div className="space-y-6 pb-6">
      {/* Заголовок экрана */}
      <div className="space-y-1 px-1">
        <h2 className="text-[26px] font-bold leading-tight tracking-tight">{t.tasks.title}</h2>
        <p className="text-[13px] text-muted-foreground">{t.tasks.subtitle}</p>
      </div>

      {/* Активные задачи */}
      {active.length > 0 && (
        <section aria-label={t.tasks.onPipeline} className="space-y-3">
          <h3 className="flex items-center gap-2 px-1 text-[15px] font-bold tracking-tight">
            {t.tasks.onPipeline}
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
                    <p className="truncate text-[14px] font-semibold">{jobName(job)}</p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {typeLabel(job.type, t)} · {fmtTime(job.createdAt)}
                    </p>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold ${
                      job.status === 'queued'
                        ? 'bg-warning/12 text-warning dark:bg-warning/20'
                        : 'bg-primary/12 text-primary dark:bg-primary/25'
                    }`}
                  >
                    {job.status === 'queued' ? (
                      <Clock className="h-3 w-3" />
                    ) : (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    )}
                    {statusText[job.status]}
                  </span>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="text-muted-foreground">{job.stageLabel ?? t.tasks.waitingSlot}</span>
                    <span className="font-bold tabular-nums text-primary">{job.progress}%</span>
                  </div>
                  <Progress value={job.progress} className="h-2" />
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {job.status === 'queued' && job.queuePosition > 0 && (
                    <Chip icon={<Clock className="h-3 w-3" />}>{t.tasks.position(job.queuePosition)}</Chip>
                  )}
                  {job.status === 'processing' && job.ramMb && (
                    <Chip icon={<MemoryStick className="h-3 w-3" />}>{t.tasks.ramChip(fmtRam(job.ramMb))}</Chip>
                  )}
                  <Chip icon={<Hourglass className="h-3 w-3" />}>{t.tasks.slotChip}</Chip>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="h-9 w-full text-[12.5px] text-muted-foreground hover:text-destructive"
                  onClick={() => cancel(job.id)}
                  disabled={cancelling === job.id}
                >
                  {cancelling === job.id ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <XCircle className="h-3.5 w-3.5" />
                  )}
                  {t.tasks.cancel}
                </Button>
              </CardContent>
            </Card>
          ))}
        </section>
      )}

      {/* История */}
      <section aria-label={t.tasks.history} className="space-y-3">
        <h3 className="flex items-center gap-2 px-1 text-[15px] font-bold tracking-tight">
          <ListVideo className="h-4 w-4 text-primary" />
          {t.tasks.history}
        </h3>

        {history.length === 0 && active.length === 0 && (
          <div className="flex flex-col items-center gap-3.5 rounded-3xl border border-dashed border-hairline px-8 py-12 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-3xl bg-primary/10 dark:bg-primary/18">
              <Film className="h-7 w-7 text-primary" />
            </div>
            <div className="space-y-1">
              <p className="text-[14px] font-semibold">{t.tasks.emptyTitle}</p>
              <p className="text-[12px] leading-relaxed text-muted-foreground">{t.tasks.emptyDesc}</p>
            </div>
          </div>
        )}

        {history.map((job) => {
          const isAnalysis = job.type === 'hook_analysis';
          const canDownload = job.status === 'completed' && Boolean(job.resultUrl) && !isAnalysis;
          return (
            <Card key={job.id} className="gap-0 py-3.5">
              <CardContent className="px-3.5">
                <div className="flex items-center gap-3">
                  {/* Векторная заглушка формата вместо битых картинок-404 */}
                  <FormatThumb job={job} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-semibold">{jobName(job)}</p>
                    <p className="text-[11.5px] text-muted-foreground">
                      {typeLabel(job.type, t)} · {fmtTime(job.createdAt)}
                      {job.resultUrl ? ' · final.mp4' : ''}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10.5px] font-semibold ${
                          job.status === 'completed'
                            ? 'bg-success/15 text-success dark:bg-success/20'
                            : job.status === 'failed'
                              ? 'bg-destructive/12 text-destructive dark:bg-destructive/25'
                              : 'bg-black/[0.06] text-muted-foreground dark:bg-white/[0.10]'
                        }`}
                      >
                        {job.status === 'completed' ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : job.status === 'failed' ? (
                          <XCircle className="h-3 w-3" />
                        ) : (
                          <Ban className="h-3 w-3" />
                        )}
                        {statusText[job.status]}
                      </span>
                    </div>
                  </div>
                  {/* Раздельные действия: анализ → «Открыть хуки», монтаж → «Скачать ролик» */}
                  {isAnalysis && job.status === 'completed' && (
                    <Button size="sm" className="h-9 shrink-0 gap-1.5 text-[12.5px]" onClick={openHooks}>
                      {t.tasks.openHooks}
                    </Button>
                  )}
                  {canDownload && (
                    <a href={job.resultUrl ?? '#'} download={`final_${job.type}_${job.id.slice(0, 6)}.mp4`}>
                      <Button size="sm" className="h-9 gap-1.5 text-[12.5px]">
                        <Download className="h-3.5 w-3.5" /> {t.tasks.downloadClip}
                      </Button>
                    </a>
                  )}
                </div>
                {job.error && <p className="mt-2.5 text-[12px] font-medium text-destructive">{job.error}</p>}
                {job.status === 'completed' && !isAnalysis && (
                  <p className="mt-2.5 text-[11px] leading-relaxed text-muted-foreground">{t.tasks.doneNote}</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </section>
    </div>
  );
}
