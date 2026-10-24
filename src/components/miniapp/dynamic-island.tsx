'use client';

// Dynamic Island — парящая капсула статуса рендера поверх контента.
// Показывается, пока у пользователя есть активные задачи: этап, процент,
// позиция в очереди, пульсирующее свечение во время рендера.

import { Clock, Loader2, MemoryStick } from 'lucide-react';
import { fmtRam } from '@/lib/client-api';
import type { Job } from '@/lib/types';

export function DynamicIsland({
  jobs,
  onOpen,
}: {
  jobs: Job[];
  onOpen: () => void;
}) {
  const processing = jobs.find((j) => j.status === 'processing');
  const queuedNext = jobs
    .filter((j) => j.status === 'queued')
    .sort((a, b) => a.queuePosition - b.queuePosition)[0];
  const job = processing ?? queuedNext;
  if (!job) return null;

  const isProcessing = job.status === 'processing';
  const queueCount = jobs.filter((j) => j.status === 'queued' || j.status === 'processing').length;

  return (
    <div className="mx-auto w-full max-w-[380px]">
      <button
        type="button"
        onClick={onOpen}
        aria-label="Открыть статус рендера"
        className={`tap-none animate-fade-up press block w-full rounded-[26px] px-4 py-2.5 text-left transition-transform ${
          isProcessing ? 'animate-island' : 'shadow-float'
        } glass-strong dark:glass-strong`}
      >
        <div className="flex items-center gap-2.5">
          {isProcessing ? (
            <span className="relative flex h-5 w-5 shrink-0 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/30" />
              <Loader2 className="relative h-4 w-4 animate-spin text-primary" />
            </span>
          ) : (
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
              <Clock className="h-4 w-4 text-warning" />
            </span>
          )}

          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold leading-tight">
              {job.stageLabel ?? (isProcessing ? 'Рендер идёт…' : 'Ожидание слота рендера')}
            </p>
            <p className="truncate text-[11px] leading-tight text-muted-foreground">
              {isProcessing ? (
                <>
                  {job.type === 'long' ? 'Long · 720p' : 'Short · 1080×1920'}
                  {job.ramMb ? (
                    <span className="inline-flex items-center gap-0.5">
                      {' '}
                      <MemoryStick className="inline h-3 w-3" /> {fmtRam(job.ramMb)}
                    </span>
                  ) : null}
                </>
              ) : (
                <>Позиция в очереди: {job.queuePosition} · впереди {Math.max(0, queueCount - 1)}</>
              )}
            </p>
          </div>

          <span className="shrink-0 rounded-full bg-primary/12 px-2 py-0.5 text-[12px] font-bold tabular-nums text-primary dark:bg-primary/20">
            {job.progress}%
          </span>
        </div>

        {/* Микро-прогресс в нижней кромке капсулы */}
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.10]">
          <div
            className={`h-full rounded-full bg-primary transition-all duration-700 ${
              isProcessing ? 'animate-shimmer bg-gradient-to-r from-primary via-[#5eb8ff] to-primary' : ''
            }`}
            style={{ width: `${Math.max(3, job.progress)}%` }}
          />
        </div>
      </button>
    </div>
  );
}
