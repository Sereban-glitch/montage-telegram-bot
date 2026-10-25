'use client';

// Вкладка «🎯 ИИ-хуки (Opus Clip)» — главная фича для друзей-блогеров:
// ссылка на любую платформу (YouTube/TikTok/Insta/…1000+ сайтов yt-dlp) →
// анализ Whisper + Hook Scorer → карточки фрагментов с превью-кадром 9:16,
// Virality Score, 3 вариантами названия (A/B/C) и 10-сек превью-видео →
// «Смонтировать этот фрагмент в 1 клик» (hook_render, priority=10).

import { useMemo, useState } from 'react';
import { Check, Clock3, Copy, Gauge, Loader2, Minus, Play, Plus, Sparkles, Target, Zap } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api } from '@/lib/client-api';
import { copyText } from '@/lib/clipboard';
import { hapticSuccess, hapticTap } from '@/lib/telegram-client';
import { useI18n } from '@/lib/i18n';
import { detectSource } from '@/lib/platforms';
import type { HookCandidate, Job, User } from '@/lib/types';
import { OnboardingSteps } from '@/components/miniapp/onboarding-steps';
import { DurationPicker, type TargetDuration } from '@/components/miniapp/duration-picker';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';

function parseJobParams(raw: string | null | undefined): Record<string, unknown> {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

const FALLBACK_THUMB = '/showcase/short-court.png';

function tc(sec: number): string {
  const s = Math.floor(sec);
  return `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// Медаль ранга: 1 — золото, 2 — серебро, 3 — бронза
const MEDAL = { 1: '#FFD60A', 2: '#C7C7CC', 3: '#FF9F0A' } as Record<number, string>;
const VARIANT_TAG = ['A', 'B', 'C'] as const;

// Тонкая подстройка границ фрагмента (аудит UX ±2–3 с, как Trim/Extend в Opus Clip):
// сдвиги старта/конца хранятся локально, передаются в hook_render.
const NUDGE_STEP = 2;
const NUDGE_MAX = 10; // суммарный сдвиг каждой границы
const MIN_LEN = 15; // минимальная длительность после подстройки

interface Nudge {
  ds: number;
  de: number;
}

function clampNudge(cand: HookCandidate, cur: Nudge, field: 'ds' | 'de', delta: number): Nudge {
  let ds = cur.ds;
  let de = cur.de;
  if (field === 'ds') ds += delta;
  else de += delta;
  ds = Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, ds));
  de = Math.max(-NUDGE_MAX, Math.min(NUDGE_MAX, de));
  // Старт не раньше нуля; длительность в разумных рамках
  if (cand.start + ds < 0) ds = -cand.start;
  const len = cand.end - cand.start + de - ds;
  if (len < MIN_LEN) {
    if (field === 'ds') ds = cand.end - cand.start + de - MIN_LEN;
    else de = MIN_LEN - (cand.end - cand.start) + ds;
  }
  return { ds, de };
}

// Кнопка «±2 с» — маленькая капсула с иконкой
function NudgeBtn({
  label,
  delta,
  onClick,
  disabled,
}: {
  label: string;
  delta: number;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="tap-none inline-flex h-7 items-center gap-0.5 rounded-lg bg-black/[0.05] px-2 text-[11px] font-semibold tabular-nums text-foreground transition-all duration-150 hover:bg-primary/15 active:scale-90 disabled:opacity-30 dark:bg-white/[0.08] dark:hover:bg-primary/25"
    >
      {delta > 0 ? <Plus className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
      {Math.abs(delta)}с
    </button>
  );
}

// Микро-шаги ожидания анализа (NN/g: perceived progress вместо голого спиннера)
function AnalysisSteps({ progress, queued }: { progress: number; queued: boolean }) {
  const { t } = useI18n();
  const steps = [t.hooks.stepAudio, t.hooks.stepTranscribe, t.hooks.stepScore];
  // Грубая оценка текущего шага по прогрессу; в очереди — ещё нулевой
  const cur = queued ? -1 : progress < 30 ? 0 : progress < 75 ? 1 : 2;
  return (
    <ol className="mt-3 space-y-1.5" aria-label={t.hooks.analysisLabel}>
      {steps.map((s, i) => {
        const done = i < cur;
        const active = i === cur;
        return (
          <li
            key={i}
            className={`flex items-center gap-2 text-[11.5px] leading-snug transition-all duration-300 ${
              done ? 'text-muted-foreground' : active ? 'font-semibold text-foreground' : 'text-muted-foreground/55'
            }`}
          >
            <span
              className={`flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border transition-all duration-300 ${
                done
                  ? 'border-[#30d158]/50 bg-[#30d158]/15 text-[#30d158]'
                  : active
                    ? 'border-primary/60 bg-primary/10 text-primary'
                    : 'border-hairline text-transparent'
              }`}
            >
              {done ? <Check className="h-3 w-3" strokeWidth={3} /> : active ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : null}
            </span>
            <span className={done ? 'line-through decoration-muted-foreground/40' : undefined}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

export function HooksTab({ user, jobs }: { user: User; jobs: Job[] }) {
  const { t } = useI18n();
  const [url, setUrl] = useState('');
  const [creating, setCreating] = useState(false);
  // Целевая длительность готовых Shorts: ⚡60 / ⏱️90 / 🎬180 сек (YouTube Shorts 2026)
  const [duration, setDuration] = useState<TargetDuration>('short');
  // Выбранный вариант названия (A/B/C) по каждому кандидату
  const [variantPick, setVariantPick] = useState<Record<number, number>>({});
  // Подстройка границ фрагмента (±2 с) по каждому кандидату
  const [nudges, setNudges] = useState<Record<number, Nudge>>({});
  // Диалог 10-сек превью
  const [previewCand, setPreviewCand] = useState<HookCandidate | null>(null);
  // Массовая постановка «Смонтировать ВСЕ» — идёт, чтобы не дублировать клики
  const [mountingAll, setMountingAll] = useState(false);

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

  const detected = useMemo(() => (url.trim() ? detectSource(url) : null), [url]);

  const analyze = async () => {
    const clean = url.trim();
    if (!clean || !/^https?:\/\//i.test(clean)) {
      toast({ title: t.hooks.needLinkTitle, description: t.hooks.needLinkDesc });
      return;
    }
    setCreating(true);
    try {
      // P0: любая платформа yt-dlp (YouTube, TikTok, Instagram, VK, RuTube…)
      const src = detectSource(clean);
      await api('/api/jobs', {
        method: 'POST',
        body: JSON.stringify({
          type: 'hook_analysis',
          sourceType: 'youtube',
          sourceUrl: clean,
          sourceName: src && src.kind === 'platform' ? `${src.label} видео` : 'Видео по ссылке',
          params: {
            overlay_label: 'КСУ',
            pill_text: 'ЩО ЦЕ ЗМІНЮЄ?',
            subtitle_lang: 'uk',
            bilingual: false,
            cover_frame: 35,
            // ⚡60 / ⏱️90 / 🎬180 сек — пресет доходит до hook_scorer на воркере
            target_duration: duration,
          },
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

  const pickVariant = (cand: HookCandidate, idx: number) => {
    hapticTap();
    setVariantPick((p) => ({ ...p, [cand.rank]: idx }));
    const v = cand.titles?.[idx] ?? cand.title;
    toast({ title: t.hooks.titleVariants, description: t.hooks.variantChosen(v) });
  };

  // ── Тонкая подстройка границ ±2 с ──
  const nudge = (cand: HookCandidate, field: 'ds' | 'de', delta: number) => {
    hapticTap();
    setNudges((p) => {
      const next = clampNudge(cand, p[cand.rank] ?? { ds: 0, de: 0 }, field, delta);
      return { ...p, [cand.rank]: next };
    });
  };

  const adjusted = (cand: HookCandidate): { start: number; end: number; n: Nudge } => {
    const n = nudges[cand.rank] ?? { ds: 0, de: 0 };
    return { start: Math.max(0, cand.start + n.ds), end: Math.max(0, cand.end + n.de), n };
  };

  // ── Копирование цитаты в 1 клик ──
  const copyQuote = async (cand: HookCandidate) => {
    hapticTap();
    const ok = await copyText(cand.quote);
    if (ok) {
      hapticSuccess();
      toast({ title: t.hooks.quoteCopied, description: t.hooks.quoteCopiedDesc });
    } else {
      toast({ title: t.hooks.failTitle, description: cand.quote });
    }
  };

  const renderCandidate = async (cand: HookCandidate, opts?: { silent?: boolean }) => {
    if (!lastAnalysis) return;
    hapticTap();
    // Титул — выбранный вариант A/B/C (по умолчанию A)
    const chosenTitle =
      cand.titles?.[variantPick[cand.rank] ?? 0] ?? cand.title;
    // Границы с учётом подстройки ±2 с
    const { start, end } = adjusted(cand);
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
            start_sec: start,
            end_sec: end,
            title_line1: chosenTitle,
            title_line2: '',
            overlay_label: 'КСУ',
            pill_text: 'ЩО ЦЕ ЗМІНЮЄ?',
            subtitle_lang: 'uk',
            bilingual: false,
            cover_frame: 35,
            target_duration: duration,
          },
        }),
      });
      hapticSuccess();
      if (!opts?.silent) {
        toast({
          title: t.hooks.queuedTitle(cand.rank, cand.score),
          description: t.hooks.queuedDesc(`${tc(start)}–${tc(end)}`),
        });
      }
    } catch (e) {
      toast({ title: t.hooks.failRender, description: e instanceof Error ? e.message : undefined });
    }
  };

  // ── «Смонтировать ВСЕ N ролика в очередь» — владелец попросил делать это в 1 клик ──
  const renderAllCandidates = async () => {
    if (!lastAnalysis || mountingAll || candidates.length === 0) return;
    hapticTap();
    setMountingAll(true);
    try {
      // Последовательно: порядок в очереди FIFO = порядок карточек (лучший — первым)
      for (const c of candidates) {
        await renderCandidate(c, { silent: true });
      }
      hapticSuccess();
      toast({ title: t.hooks.mountAllDoneTitle, description: t.hooks.mountAllDoneDesc });
    } finally {
      setMountingAll(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Закреплённый онбординг «3 шага» — персональный для хуков */}
      <OnboardingSteps tab="hooks" />

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

      {/* Источник — любая платформа */}
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
        {/* Мгновенное распознавание платформы */}
        {url.trim() && detected && (
          <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px] font-medium text-[#30d158]" role="status">
            <span aria-hidden>{detected.emoji}</span>
            {t.hooks.detected(detected.label)}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
          <span className="rounded-full bg-black/[0.04] px-2.5 py-1 dark:bg-white/[0.07]">{t.hooks.platformChip}</span>
          <span className="rounded-full bg-black/[0.04] px-2.5 py-1 dark:bg-white/[0.07]">{t.hooks.chip1}</span>
          <span className="rounded-full bg-black/[0.04] px-2.5 py-1 dark:bg-white/[0.07]">{t.hooks.chip2}</span>
          <span className="rounded-full bg-black/[0.04] px-2.5 py-1 dark:bg-white/[0.07]">{t.hooks.chip3}</span>
        </div>
      </section>

      {/* Селектор целевой длительности: ⚡60 / ⏱️90 / 🎬180 сек (YouTube Shorts 2026) */}
      <DurationPicker value={duration} onChange={setDuration} label={t.dur.hooksLabel} />

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
          <AnalysisSteps
            progress={activeAnalysis.progress}
            queued={activeAnalysis.status === 'queued'}
          />
        </section>
      )}

      {/* Карточки кандидатов: превью-кадр 9:16 + Virality + варианты названия + превью-видео */}
      {candidates.length > 0 && (
        <section className="space-y-3">
          {/* Бейдж «Найдено 3 отдельных ролика на выбор» + «Смонтировать ВСЕ» (отзыв владельца) */}
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-primary/25 bg-primary/[0.07] px-3.5 py-2.5 dark:bg-primary/[0.13]">
            <p className="flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold text-primary">
              <Sparkles className="h-4 w-4 shrink-0" aria-hidden />
              {t.hooks.foundBadge(candidates.length)}
            </p>
            <Button
              size="sm"
              className="h-9 shrink-0 gap-1.5 rounded-xl px-3 text-[12px] font-semibold"
              disabled={mountingAll}
              onClick={renderAllCandidates}
            >
              {mountingAll ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
              {t.hooks.mountAll(candidates.length)}
            </Button>
          </div>
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
              {t.hooks.bestMoments} {lastAnalysis ? `· ${lastAnalysis.sourceName ?? 'видео'}` : ''}
            </h3>
            <span className="text-[11px] text-muted-foreground">{t.hooks.nFragments(candidates.length)}</span>
          </div>
          {candidates.map((c) => {
            const picked = variantPick[c.rank] ?? 0;
            const variants = c.titles?.length ? c.titles : [c.title];
            const { start, end, n } = adjusted(c);
            const isAdjusted = n.ds !== 0 || n.de !== 0;
            const dur = Math.round(end - start);
            return (
              <article
                key={c.rank}
                className="animate-fade-up rounded-3xl border border-hairline bg-card p-3.5 shadow-soft"
              >
                <div className="flex gap-3">
                  {/* Превью-кадр фрагмента 9:16 (P0: как Opus Clip) */}
                  <button
                    type="button"
                    className="tap-none group relative aspect-[9/16] w-[86px] shrink-0 overflow-hidden rounded-2xl ring-1 ring-black/10 transition-all duration-200 hover:ring-primary/50 active:scale-[0.97] dark:ring-white/15"
                    style={{
                      backgroundImage: `url('${c.thumb ?? FALLBACK_THUMB}')`,
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                    }}
                    aria-label={t.hooks.previewTitle(c.rank)}
                    onClick={() => setPreviewCand(c)}
                  >
                    {/* Virality Score поверх кадра */}
                    <span
                      className="absolute left-1 top-1 flex h-8 w-8 items-center justify-center rounded-xl text-[12px] font-extrabold tabular-nums backdrop-blur-md"
                      style={{
                        color: MEDAL[c.rank] ?? '#ffffff',
                        background: 'rgba(0,0,0,0.55)',
                      }}
                    >
                      {c.score}
                    </span>
                    {/* Play-оверлей → 10-сек превью */}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/0 transition-colors duration-200 group-hover:bg-black/25">
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/90 opacity-0 shadow-float transition-opacity duration-200 group-hover:opacity-100">
                        <Play className="h-4 w-4 fill-black text-black" />
                      </span>
                    </span>
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1 pb-1 pt-4 text-center text-[8.5px] font-semibold uppercase tracking-wide text-white/95">
                      {t.hooks.preview}
                    </span>
                  </button>

                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary dark:bg-primary/20">
                        #{c.rank}
                      </span>
                      <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
                        <Clock3 className="h-3 w-3" />
                        {tc(start)} · {dur} {t.hooks.sec}
                      </span>
                      <span className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {t.hooks.virality} {c.score}
                      </span>
                      {/* Микро-бейджи: топ-хук и факт подстройки */}
                      {c.score >= 90 && (
                        <span className="rounded-full bg-[#ff9f0a]/15 px-2 py-0.5 text-[9px] font-bold text-[#ff9f0a] dark:bg-[#ff9f0a]/25">
                          {t.hooks.badgeTop}
                        </span>
                      )}
                      {isAdjusted && (
                        <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[9px] font-semibold text-primary dark:bg-primary/25">
                          {t.hooks.adjustedBadge}
                        </span>
                      )}
                    </div>
                    <p className="text-[14px] font-semibold leading-snug">{variants[picked] ?? c.title}</p>
                    {/* Цитата — клик по иконке копирует в 1 клик */}
                    <p className="group/quote mt-1 flex items-start gap-1.5 text-[12.5px] italic leading-snug text-muted-foreground">
                      <button
                        type="button"
                        onClick={() => copyQuote(c)}
                        aria-label={t.hooks.copyQuote}
                        title={t.hooks.copyQuote}
                        className="tap-none mt-0.5 shrink-0 rounded-md p-0.5 text-muted-foreground/60 transition-all hover:bg-primary/12 hover:text-primary active:scale-90"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                      <span className="line-clamp-2">«{c.quote}»</span>
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
                  </div>
                </div>

                {/* Варианты названия A/B/C (P2: 10 вариантов названий OpenShorts — здесь 3 самых сильных) */}
                {variants.length > 1 && (
                  <div className="mt-2.5">
                    <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {t.hooks.titleVariants}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {variants.slice(0, 3).map((v, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => pickVariant(c, idx)}
                          title={v}
                          aria-pressed={idx === picked}
                          className={`tap-none max-w-full truncate rounded-full px-2.5 py-1 text-[11px] font-medium transition-all duration-150 active:scale-[0.96] ${
                            idx === picked
                              ? 'bg-primary text-white shadow-glow'
                              : 'bg-black/[0.05] text-foreground hover:bg-primary/12 dark:bg-white/[0.08] dark:hover:bg-primary/25'
                          }`}
                        >
                          <span className="mr-1 font-bold opacity-70">{VARIANT_TAG[idx]}</span>
                          {v.length > 34 ? `${v.slice(0, 34)}…` : v}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 text-[10px] leading-snug text-muted-foreground/80">{t.hooks.variantHint}</p>
                  </div>
                )}

                {/* Тонкая подстройка границ ±2 с (аудит UX: как Trim/Extend в Opus Clip) */}
                <div className="mt-2.5 rounded-2xl bg-black/[0.03] px-3 py-2.5 dark:bg-white/[0.05]">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t.hooks.adjustLabel}
                  </p>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <div className="flex items-center gap-1.5">
                      <span className="w-[52px] text-[11px] font-medium text-muted-foreground">
                        {t.hooks.startLabel}
                      </span>
                      <NudgeBtn
                        label={`${t.hooks.startLabel} −${NUDGE_STEP}с`}
                        delta={-NUDGE_STEP}
                        onClick={() => nudge(c, 'ds', -NUDGE_STEP)}
                        disabled={start <= 0}
                      />
                      <span className="w-[64px] text-center font-mono text-[11px] font-semibold tabular-nums text-foreground">
                        {tc(start)}
                      </span>
                      <NudgeBtn
                        label={`${t.hooks.startLabel} +${NUDGE_STEP}с`}
                        delta={NUDGE_STEP}
                        onClick={() => nudge(c, 'ds', NUDGE_STEP)}
                      />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="w-[52px] text-[11px] font-medium text-muted-foreground">
                        {t.hooks.endLabel}
                      </span>
                      <NudgeBtn
                        label={`${t.hooks.endLabel} −${NUDGE_STEP}с`}
                        delta={-NUDGE_STEP}
                        onClick={() => nudge(c, 'de', -NUDGE_STEP)}
                        disabled={dur <= MIN_LEN}
                      />
                      <span className="w-[64px] text-center font-mono text-[11px] font-semibold tabular-nums text-foreground">
                        {tc(end)}
                      </span>
                      <NudgeBtn
                        label={`${t.hooks.endLabel} +${NUDGE_STEP}с`}
                        delta={NUDGE_STEP}
                        onClick={() => nudge(c, 'de', NUDGE_STEP)}
                      />
                    </div>
                    <span className="ml-auto rounded-full bg-primary/12 px-2.5 py-0.5 text-[10px] font-semibold tabular-nums text-primary dark:bg-primary/25">
                      {t.hooks.durationLabel} {dur} {t.hooks.sec}
                    </span>
                  </div>
                </div>

                <Button
                  size="lg"
                  className="mt-3 h-11 w-full rounded-2xl text-[13.5px] font-semibold"
                  onClick={() => renderCandidate(c)}
                >
                  🎬 {t.hooks.mount}
                </Button>
              </article>
            );
          })}
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

      {/* Диалог 10-секундного превью (P1) */}
      <Dialog open={Boolean(previewCand)} onOpenChange={(v) => !v && setPreviewCand(null)}>
        <DialogContent className="max-w-[92vw] gap-3 rounded-3xl p-4 sm:max-w-sm">
          {previewCand && (
            <>
              <DialogHeader className="space-y-1 text-left">
                <DialogTitle className="text-[16px] leading-snug tracking-tight">
                  {t.hooks.previewTitle(previewCand.rank)}
                </DialogTitle>
                <DialogDescription className="text-[12px]">{t.hooks.previewNote}</DialogDescription>
              </DialogHeader>
              <video
                key={previewCand.rank}
                className="mx-auto aspect-[9/16] max-h-[62vh] w-auto rounded-2xl bg-black ring-1 ring-black/10 dark:ring-white/15"
                src={previewCand.previewUrl ?? '/demo/final_short.mp4'}
                poster={previewCand.thumb ?? FALLBACK_THUMB}
                controls
                autoPlay
                playsInline
                preload="metadata"
              />
              <div className="flex items-center justify-center gap-2 text-[11px] text-muted-foreground">
                <Clock3 className="h-3 w-3" />
                {(() => {
                  const a = adjusted(previewCand);
                  return `${tc(a.start)}–${tc(a.end)}`;
                })()}{' '}
                · Virality {previewCand.score}%
              </div>
              <Button
                size="lg"
                className="h-11 w-full rounded-2xl text-[13.5px] font-semibold"
                onClick={() => {
                  const c = previewCand;
                  setPreviewCand(null);
                  renderCandidate(c);
                }}
              >
                🎬 {t.hooks.mount}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
