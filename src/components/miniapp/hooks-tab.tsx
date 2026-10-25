'use client';

// Вкладка «🎯 ИИ-хуки (Opus Clip)» — главная фича для друзей-блогеров:
// YouTube-ссылка → анализ Whisper + Hook Scorer → карточки фрагментов
// с Virality Score → «Смонтировать этот фрагмент в 1 клик» (hook_render, priority=10).

import { useMemo, useState } from 'react';
import {
  Clock3,
  Gauge,
  Loader2,
  Target,
  Zap,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api } from '@/lib/client-api';
import { hapticTap } from '@/lib/telegram-client';
import { useI18n } from '@/lib/i18n';
import type { HookCandidate, Job, User } from '@/lib/types';
import { OnboardingSteps } from '@/components/miniapp/onboarding-steps';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';

function parseJobParams(raw: string | null | undefined): Record<string, unknown> {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const YT_RE = /(youtube\.com|youtu\.be)/i;

function tc(sec: number): string {
  const s = Math.floor(sec);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// Медаль ранга: 1 — золото, 2 — серебро, 3 — бронза
const MEDAL = { 1: '#FFD60A', 2: '#C7C7CC', 3: '#FF9F0A' } as Record<number, string>;

export function HooksTab({ user, jobs }: { user: User; jobs: Job[] }) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [creating, setCreating] = useState(false);

  // Последний анализ: активный или завершённый (с кандидатами)
  const { activeAnalysis, lastAnalysis, candidates } = useMemo(() => {
    const analyses = jobs
      .filter((j) => j.type === 'hook_analysis')
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const active = analyses.find((j) => j.status === 'queued' || j.status === 'processing') ?? null;
    const done = analyses.find((j) => j.status === 'completed') ?? null;
    const cands = done ? ((parseJobParams(done.params).candidates as HookCandidate[] | undefined) ?? []) : [];
    return { activeAnalysis: active, lastAnalysis: done, candidates: cands };
  }, [jobs]);

  const renderedHooks = useMemo(
    () =>
      jobs
        .filter((j) => j.type === 'hook_render')
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, 4),
    [jobs],
  );

  const analyze = async () => {
    const clean = url.trim();
    if (!clean || !/^https?:\/\//i.test(clean)) {
      toast({ title: t.hooks.needLinkTitle, description: t.hooks.needLinkDesc });
      return;
    }
    if (!YT_RE.test(clean)) {
      toast({ title: t.hooks.notYtTitle, description: t.hooks.notYtDesc });
      return;
    }
    setCreating(true);
    try {
      await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          type: 'hook_analysis',
          sourceType: 'youtube',
          sourceUrl: clean,
          sourceName: 'YouTube видео',
          params: { overlay_label: 'КСУ', pill_text: 'ЩО ЦЕ ЗМІНЮЄ?', subtitle_lang: 'uk', bilingual: false, cover_frame: 35 },
        }),
      });
      setUrl('');
      toast({
        title: t.hooks.startedTitle,
        description: t.hooks.startedDesc,
      });
    } catch (e) {
      toast({ title: t.hooks.failAnalyze, description: e instanceof Error ? e.message : undefined });
    } finally {
      setCreating(false);
    }
  };

  const renderCandidate = async (cand: HookCandidate) => {
    if (!lastAnalysis) return;
    hapticTap();
    try {
      await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          type: 'hook_render',
          sourceType: 'youtube',
          sourceUrl: lastAnalysis.sourceUrl,
          sourceName: `Hook #${cand.rank} · ${cand.score}%`,
          params: {
            analysis_job_id: lastAnalysis.id,
            rank: cand.rank,
            start_sec: cand.start,
            end_sec: cand.end,
            title_line1: cand.title,
            title_line2: '',
            overlay_label: 'КСУ',
            pill_text: 'ЩО ЦЕ ЗМІНЮЄ?',
            subtitle_lang: 'uk',
            bilingual: false,
            cover_frame: 35,
          },
        }),
      });
      toast({
        title: t.hooks.queuedTitle(cand.rank, cand.score),
        description: t.hooks.queuedDesc(`${tc(cand.start)}–${tc(cand.end)}`),
      });
    } catch (e) {
      toast({ title: t.hooks.failRender, description: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="space-y-5">
      {/* Закреплённый онбординг «3 шага» — для чайников */}
      <OnboardingSteps />

      {/* Large Title + подзаголовок */}
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-gradient-to-b from-[#ff9f0a] to-[#ff6b00] shadow-soft">
          <Target className="h-6 w-6 text-white" />
        </div>
        <div className="min-w-0">
          <h2 className="text-[26px] font-bold leading-tight tracking-tight">{t.hooks.title}</h2>
          <p className="text-[13px] leading-snug text-muted-foreground">{t.hooks.subtitle}</p>
        </div>
      </div>

      {/* Источник */}
      <section className="rounded-3xl border border-hairline bg-card p-4 shadow-soft">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {t.hooks.sourceLabel}
        </p>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={t.hooks.placeholder}
            inputMode="url"
            autoComplete="off"
            className="h-11 flex-1 rounded-xl"
            onKeyDown={(e) => e.key === 'Enter' && !creating && analyze()}
          />
          <Button
            size="lg"
            disabled={creating || Boolean(activeAnalysis)}
            onClick={analyze}
            className="h-[52px] shrink-0 rounded-2xl text-[15px] font-semibold"
          >
            {creating || activeAnalysis ? (
              <Loader2 className="h-4.5 w-4.5 animate-spin" />
            ) : (
              <Zap className="h-4.5 w-4.5" />
            )}
            {activeAnalysis || creating ? t.hooks.analyzing : t.hooks.find}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
          <span className="rounded-full bg-black/[0.04] px-2.5 py-1 dark:bg-white/[0.07]">{t.hooks.chip1}</span>
          <span className="rounded-full bg-black/[0.04] px-2.5 py-1 dark:bg-white/[0.07]">{t.hooks.chip2}</span>
          <span className="rounded-full bg-black/[0.04] px-2.5 py-1 dark:bg-white/[0.07]">{t.hooks.chip3}</span>
        </div>
      </section>

      {/* Индикатор анализа */}
      {activeAnalysis && (
        <section className="animate-fade-up rounded-3xl border border-primary/25 bg-primary/[0.06] p-4 shadow-soft dark:bg-primary/[0.12]">
          <div className="mb-2 flex items-center gap-2.5">
            <Zap className="h-4.5 w-4.5 animate-pulse text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold">{activeAnalysis.stageLabel ?? t.hooks.analysisLabel}</p>
              <p className="text-[11px] text-muted-foreground">
                {activeAnalysis.status === 'queued'
                  ? t.hooks.queueHint(activeAnalysis.queuePosition || 1)
                  : t.hooks.runHint}
              </p>
            </div>
            <span className="text-[15px] font-bold tabular-nums text-primary">{activeAnalysis.progress}%</span>
          </div>
          <Progress value={activeAnalysis.progress} className="h-2" />
        </section>
      )}

      {/* Карточки кандидатов */}
      {candidates.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t.hooks.bestMoments} {lastAnalysis ? `· ${lastAnalysis.sourceName ?? 'видео'}` : ''}
            </h3>
            <span className="text-[11px] text-muted-foreground">{t.hooks.nFragments(candidates.length)}</span>
          </div>
          {candidates.map((c) => (
            <article
              key={c.rank}
              className="animate-fade-up rounded-3xl border border-hairline bg-card p-4 shadow-soft"
            >
              <div className="flex items-start gap-3">
                {/* Virality Score */}
                <div className="flex w-14 shrink-0 flex-col items-center gap-0.5">
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-2xl text-[15px] font-extrabold tabular-nums"
                    style={{
                      color: MEDAL[c.rank] ?? 'var(--primary)',
                      background: `${MEDAL[c.rank] ?? '#007aff'}1f`,
                    }}
                  >
                    {c.score}
                  </div>
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {t.hooks.virality}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary dark:bg-primary/20">
                      #{c.rank}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
                      <Clock3 className="h-3 w-3" />
                      {tc(c.start)} · {Math.round(c.duration)} {t.hooks.sec}
                    </span>
                  </div>
                  <p className="text-[14px] font-semibold leading-snug">{c.title}</p>
                  <p className="mt-1 line-clamp-2 text-[12.5px] italic leading-snug text-muted-foreground">
                    «{c.quote}»
                  </p>
                  {c.breakdown && (
                    <div className="mt-2 grid grid-cols-4 gap-1.5" title={t.hooks.breakdownTitle}>
                      {(
                        [
                          [t.hooks.bdHook, c.breakdown.hook],
                          [t.hooks.bdIdea, c.breakdown.completeness],
                          [t.hooks.bdEmotion, c.breakdown.emotion],
                          [t.hooks.bdRetention, c.breakdown.retention],
                        ] as const
                      ).map(([label, v]) => (
                        <div key={label}>
                          <div className="h-1 overflow-hidden rounded-full bg-black/[0.06] dark:bg-white/[0.1]">
                            <div className="h-full rounded-full bg-primary/70" style={{ width: `${v}%` }} />
                          </div>
                          <p className="mt-0.5 text-[9px] text-muted-foreground">
                            {label} <span className="tabular-nums">{v}</span>
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                  <Button
                    size="lg"
                    className="mt-3 h-11 w-full rounded-2xl text-[13.5px] font-semibold"
                    onClick={() => renderCandidate(c)}
                  >
                    🎬 {t.hooks.mount}
                  </Button>
                </div>
              </div>
            </article>
          ))}
        </section>
      )}

      {/* Пустое состояние */}
      {!candidates.length && !activeAnalysis && (
        <section className="rounded-3xl border border-dashed border-hairline bg-card/50 p-6 text-center">
          <Target className="mx-auto mb-2 h-8 w-8 text-muted-foreground/50" />
          <p className="text-[13px] font-medium">{t.hooks.emptyTitle}</p>
          <p className="mx-auto mt-1 max-w-[280px] text-[12px] leading-relaxed text-muted-foreground">
            {t.hooks.emptyDesc}
          </p>
        </section>
      )}

      {/* Смонтированные хуки */}
      {renderedHooks.length > 0 && (
        <section className="space-y-2">
          <h3 className="px-1 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t.hooks.rendered}
          </h3>
          {renderedHooks.map((j) => (
            <div
              key={j.id}
              className="flex items-center gap-3 rounded-2xl border border-hairline bg-card px-3.5 py-2.5 shadow-soft"
            >
              <Gauge className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium">{j.sourceName}</p>
                <p className="text-[11px] text-muted-foreground">
                  {j.status === 'completed' ? t.hooks.renderedDone : `${j.stageLabel ?? ''} · ${j.progress}%`}
                </p>
              </div>
              {j.status === 'completed' ? (
                <span className="rounded-full bg-[#30d158]/15 px-2.5 py-1 text-[10px] font-bold text-[#30d158]">MP4</span>
              ) : (
                <span className="text-[11px] font-semibold tabular-nums text-primary">{j.progress}%</span>
              )}
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
