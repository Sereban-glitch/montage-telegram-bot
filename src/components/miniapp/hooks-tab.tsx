'use client';

// Вкладка «🎯 ИИ-хуки (Opus Clip)» — главная фича для друзей-блогеров:
// YouTube-ссылка → анализ Whisper + Hook Scorer → карточки фрагментов
// с Virality Score → «Смонтировать в 1 клик» (hook_render, priority=10).

import { useMemo, useState } from 'react';
import {
  Clock3,
  Gauge,
  Loader2,
  Scissors,
  Sparkles,
  Target,
  Zap,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api, fmtDuration } from '@/lib/client-api';
import type { HookCandidate, Job, User } from '@/lib/types';
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

function scoreColor(score: number): string {
  if (score >= 90) return 'text-[#30d158]';
  if (score >= 75) return 'text-primary';
  return 'text-[#ff9f0a]';
}

export function HooksTab({ user, jobs }: { user: User; jobs: Job[] }) {
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
      toast({ title: 'Нужна ссылка', description: 'Вставьте ссылку на длинное видео с YouTube' });
      return;
    }
    if (!YT_RE.test(clean)) {
      toast({ title: 'Это не YouTube', description: 'ИИ-хуки работают с youtube.com / youtu.be ссылками' });
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
        title: '🎯 Анализ запущен',
        description: 'Скачаю только аудио → Whisper по таймкодам → Hook Scorer. Кандидаты появятся здесь через пару минут.',
      });
    } catch (e) {
      toast({ title: 'Не удалось запустить анализ', description: e instanceof Error ? e.message : undefined });
    } finally {
      setCreating(false);
    }
  };

  const renderCandidate = async (cand: HookCandidate) => {
    if (!lastAnalysis) return;
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
      toast({ title: `🎬 Shorts #${cand.rank} в очереди`, description: `Фрагмент ${tc(cand.start)}–${tc(cand.end)} — фирменный монтаж 1080×1920` });
    } catch (e) {
      toast({ title: 'Ошибка постановки', description: e instanceof Error ? e.message : undefined });
    }
  };

  return (
    <div className="space-y-5">
      {/* Large Title + подзаголовок */}
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[16px] bg-gradient-to-b from-[#ff9f0a] to-[#ff6b00] shadow-soft">
          <Target className="h-6 w-6 text-white" />
        </div>
        <div className="min-w-0">
          <h2 className="text-[26px] font-bold leading-tight tracking-tight">ИИ-хуки (Opus Clip)</h2>
          <p className="text-[13px] leading-snug text-muted-foreground">
            Превращаю длинные видео в вирусные Shorts за 60 секунд без монтажёров
          </p>
        </div>
      </div>

      {/* Карточка-онбординг: как это работает за 3 шага */}
      <div className="rounded-3xl border border-primary/25 bg-gradient-to-br from-primary/[0.08] via-primary/[0.02] to-transparent p-4 shadow-soft">
        <div className="flex items-center gap-2 mb-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white text-xs font-bold">⚡</span>
          <h3 className="text-[14px] font-bold tracking-tight">Как это работает (просто и понятно):</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-[12px] text-muted-foreground mt-2.5">
          <div className="flex items-start gap-2 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] p-2.5">
            <span className="font-bold text-primary text-[13px]">1️⃣</span>
            <span><strong>Вставь ссылку</strong> на любое YouTube-видео или стрим ниже</span>
          </div>
          <div className="flex items-start gap-2 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] p-2.5">
            <span className="font-bold text-primary text-[13px]">2️⃣</span>
            <span><strong>ИИ найдёт 3 лучших момента</strong> по 35–55 сек с оценкой вирусности</span>
          </div>
          <div className="flex items-start gap-2 rounded-2xl bg-black/[0.03] dark:bg-white/[0.05] p-2.5">
            <span className="font-bold text-primary text-[13px]">3️⃣</span>
            <span><strong>Жми «Смонтировать»</strong> — готовый Shorts с субтитрами придёт в Telegram!</span>
          </div>
        </div>
      </div>

      {/* Источник */}
      <section className="rounded-3xl border border-hairline bg-card p-4 shadow-soft">
        <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          Источник — ссылка на длинное видео (20–60 мин)
        </p>
        <div className="flex flex-col gap-2.5 sm:flex-row">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://youtube.com/watch?v=…"
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
            {creating || activeAnalysis ? <Loader2 className="h-4.5 w-4.5 animate-spin" /> : <Zap className="h-4.5 w-4.5" />}
            {activeAnalysis ? 'Анализирую…' : 'Найти хуки'}
          </Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5 text-[11px] text-muted-foreground">
          <span className="rounded-full bg-black/[0.04] px-2.5 py-1 dark:bg-white/[0.07]">🔊 только аудио — быстро</span>
          <span className="rounded-full bg-black/[0.04] px-2.5 py-1 dark:bg-white/[0.07]">🗣 Whisper-таймкоды</span>
          <span className="rounded-full bg-black/[0.04] px-2.5 py-1 dark:bg-white/[0.07]">🧠 Hook Scorer 35–55 с</span>
        </div>
      </section>

      {/* Индикатор анализа */}
      {activeAnalysis && (
        <section className="animate-fade-up rounded-3xl border border-primary/25 bg-primary/[0.06] p-4 shadow-soft dark:bg-primary/[0.12]">
          <div className="mb-2 flex items-center gap-2.5">
            <Sparkles className="h-4.5 w-4.5 animate-pulse text-primary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[14px] font-semibold">{activeAnalysis.stageLabel ?? 'Анализ видео'}</p>
              <p className="text-[11px] text-muted-foreground">
                {activeAnalysis.status === 'queued'
                  ? `В очереди · позиция ${activeAnalysis.queuePosition || 1} — ваш приоритет высший`
                  : 'Whisper разбирает речь по секундам, затем Hook Scorer оценит фрагменты'}
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
              Лучшие моменты {lastAnalysis ? `· ${lastAnalysis.sourceName ?? 'видео'}` : ''}
            </h3>
            <span className="text-[11px] text-muted-foreground">{candidates.length} фрагмента</span>
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
                    Virality
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary dark:bg-primary/20">
                      #{c.rank}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] tabular-nums text-muted-foreground">
                      <Clock3 className="h-3 w-3" />
                      {tc(c.start)} · {Math.round(c.duration)} c
                    </span>
                  </div>
                  <p className="text-[14px] font-semibold leading-snug">{c.title}</p>
                  <p className="mt-1 line-clamp-2 text-[12.5px] italic leading-snug text-muted-foreground">
                    «{c.quote}»
                  </p>
                  {c.breakdown && (
                    <div className="mt-2 grid grid-cols-4 gap-1.5" title="Хук в 3 с · Завершённость · Эмоции · Удержание">
                      {(
                        [
                          ['Хук', c.breakdown.hook],
                          ['Мысль', c.breakdown.completeness],
                          ['Эмоции', c.breakdown.emotion],
                          ['Удерж.', c.breakdown.retention],
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
                    className="mt-3 h-11 w-full rounded-2xl text-[14px] font-semibold"
                    onClick={() => renderCandidate(c)}
                  >
                    <Scissors className="h-4 w-4" />
                    Смонтировать в 1 клик
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
          <p className="text-[13px] font-medium">Хуков пока нет</p>
          <p className="mx-auto mt-1 max-w-[280px] text-[12px] leading-relaxed text-muted-foreground">
            Вставьте ссылку на заседание, интервью или стрим — ИИ найдёт 3–5 фрагментов с максимальным вирусным потенциалом и оценит их Virality Score.
          </p>
        </section>
      )}

      {/* Смонтированные хуки */}
      {renderedHooks.length > 0 && (
        <section className="space-y-2">
          <h3 className="px-1 text-[13px] font-semibold uppercase tracking-wider text-muted-foreground">
            Смонтированные фрагменты
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
                  {j.status === 'completed' ? 'Готово · видео в чате и в «Задачах»' : `${j.stageLabel ?? ''} · ${j.progress}%`}
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
