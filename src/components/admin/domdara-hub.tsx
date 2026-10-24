'use client';

// Раздел «🏛️ Domdara News Hub» (Admin Mode): мониторинг статей судебной практики
// с domdara.org, превью 4 слайдов (Хук / Дело / Вердикт / Вывод), сценарий,
// аудио озвучки, ручная генерация и Human-in-the-Loop модерация.

import { useCallback, useEffect, useState } from 'react';
import {
  BadgeCheck,
  BookOpenText,
  ExternalLink,
  FileText,
  Gavel,
  Lightbulb,
  Loader2,
  PlayCircle,
  RefreshCw,
  XCircle,
  Zap,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api } from '@/lib/client-api';
import type { Job, NewsArticle } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

type FeedInfo = { url: string; enabled: boolean; dailyMax: number };
type ArticleWithJob = NewsArticle & { job?: Job | null };

const STATE_LABEL: Record<string, { text: string; cls: string }> = {
  new: { text: 'Новая', cls: 'bg-primary/12 text-primary dark:bg-primary/22' },
  queued: { text: 'В фоновой очереди', cls: 'bg-[#af52de]/12 text-[#af52de] dark:bg-[#bf5af2]/22' },
  rendered: { text: 'Готово · на модерации', cls: 'bg-[#ff9f0a]/15 text-[#ff9f0a] dark:bg-[#ff9f0a]/22' },
  approved: { text: 'Одобрено · YouTube private', cls: 'bg-[#30d158]/15 text-[#30d158] dark:bg-[#30d158]/22' },
  rejected: { text: 'Отклонено', cls: 'bg-[#ff3b30]/12 text-[#ff3b30] dark:bg-[#ff3b30]/20' },
  regenerate: { text: 'Перегенерация', cls: 'bg-primary/12 text-primary dark:bg-primary/22' },
  failed: { text: 'Ошибка', cls: 'bg-[#ff3b30]/12 text-[#ff3b30] dark:bg-[#ff3b30]/20' },
  skipped: { text: 'Брак (фильтр)', cls: 'bg-black/[0.05] text-muted-foreground dark:bg-white/[0.09]' },
};

// 4 слайда превью: Хук / Дело / Вердикт / Вывод — из сценария задачи либо эвристически из сниппета
function buildSlides(article: ArticleWithJob): { icon: typeof Zap; label: string; text: string }[] {
  const p = article.job ? safeParams(article.job.params) : {};
  const sentences = article.snippet.split(/(?<=[.!?…])\s+/).filter((s) => s.length > 20);
  const hook = (p.hook as string) ?? `${article.title.split(':')[0].slice(0, 70)} — что решил суд?`;
  const fabula = (p.fabula as string) ?? sentences[0] ?? article.snippet.slice(0, 140);
  const verdict = (p.verdict as string) ?? sentences.find((s) => /суд|кассаци|подтверд|скасув|постанов/i.test(s)) ?? sentences[1] ?? '—';
  const conclusion = (p.conclusion as string) ?? sentences[sentences.length - 1] ?? article.snippet.slice(-140);
  return [
    { icon: Zap, label: 'Хук', text: hook },
    { icon: FileText, label: 'Дело', text: fabula },
    { icon: Gavel, label: 'Вердикт', text: verdict },
    { icon: Lightbulb, label: 'Вывод', text: conclusion },
  ];
}

function safeParams(raw: string | null | undefined): Record<string, unknown> {
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function caseNo(article: ArticleWithJob): string | null {
  const m = (article.snippet + ' ' + article.title).match(/№\s*([\dа-яА-Я/]+-\d+)/);
  return m ? `№ ${m[1]}` : null;
}

function SlideCard({ icon: Icon, label, text, i }: { icon: typeof Zap; label: string; text: string; i: number }) {
  return (
    <div
      className="relative flex aspect-[9/16] min-w-0 flex-col overflow-hidden rounded-xl border border-[#d4af37]/40 bg-gradient-to-b from-[#0a1830] via-[#0f2447] to-[#173b6b] p-2 shadow-soft"
      title={text}
    >
      <span className="pointer-events-none absolute -right-2 -bottom-3 text-[44px] leading-none text-[#d4af37]/10 select-none">
        §
      </span>
      <div className="flex items-center gap-1">
        <Icon className="h-3 w-3 shrink-0 text-[#d4af37]" />
        <span className="truncate text-[8.5px] font-bold uppercase tracking-wider text-[#d4af37]">{label}</span>
      </div>
      <p className="mt-1 line-clamp-4 text-[8.5px] leading-snug text-[#e8f1ff]/90">{text.slice(0, 110)}</p>
      <span className="mt-auto text-[7px] font-semibold text-[#d4af37]/60">СЛАЙД {i + 1}/4</span>
    </div>
  );
}

export function DomdaraHub() {
  const [articles, setArticles] = useState<ArticleWithJob[]>([]);
  const [feed, setFeed] = useState<FeedInfo | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const data = await api<{ articles: ArticleWithJob[]; feed: FeedInfo }>('/api/admin/domdara');
      setArticles(data.articles);
      setFeed(data.feed);
    } catch {
      /* 403 или сеть */
    }
  }, []);

  useEffect(() => {
    const t0 = setTimeout(load, 0);
    const t = setInterval(() => {
      if (!document.hidden) load();
    }, 3000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [load]);

  const act = async (payload: Record<string, string>, okTitle: string, okDesc?: string) => {
    setBusy(payload.articleId ?? payload.jobId ?? 'x');
    try {
      await api('/api/admin/domdara', { method: 'POST', body: JSON.stringify(payload) });
      toast({ title: okTitle, description: okDesc });
      await load();
    } catch (e) {
      toast({ title: 'Не выполнено', description: e instanceof Error ? e.message : undefined });
    } finally {
      setBusy(null);
    }
  };

  const activeNews = articles.filter((a) => a.job && ['queued', 'processing'].includes(a.job.status));

  return (
    <div className="animate-fade-up space-y-4">
      {/* Заголовок раздела + статус фида */}
      <Card className="gap-0 py-4">
        <CardHeader className="px-4 pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-[14px]">
            <BookOpenText className="h-4 w-4 text-primary" />
            Domdara News Hub · правовой контент
            <Badge variant="secondary" className="font-mono text-[10px]">{feed?.url ?? 'http://domdara.org/feed/'}</Badge>
            <span className="ml-auto text-[11px] font-normal text-muted-foreground">
              фон priority=1 · максимум {feed?.dailyMax ?? 2}/день · синглтон
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Генерация News Shorts из судебной практики запускается <b>только когда очередь друзей пуста</b> —
            Zero-Conflict Queue не даст фону занять слот рендера. Ролик никогда не публикуется сам:
            после рендера он приходит на модерацию — «Одобрить» отправит его на YouTube в статусе <b>private</b>.
          </p>
        </CardContent>
      </Card>

      {/* Активная фоновая генерация */}
      {activeNews.map((a) => (
        <Card key={a.id} className="gap-0 border-primary/25 bg-primary/[0.05] py-4 dark:bg-primary/[0.1]">
          <CardContent className="px-4">
            <div className="flex items-center gap-2.5">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold">{a.title}</p>
                <p className="text-[11px] text-muted-foreground">{a.job?.stageLabel ?? 'в очереди'} · {a.job?.progress ?? 0}%</p>
              </div>
              <span className="text-[14px] font-bold tabular-nums text-primary">{a.job?.progress ?? 0}%</span>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* Карточки статей */}
      {articles.map((a) => {
        const state = STATE_LABEL[a.state] ?? STATE_LABEL.new;
        const slides = buildSlides(a);
        const isSkipped = a.state === 'skipped';
        const jobDone = a.job?.status === 'completed';
        const canGenerate = ['new'].includes(a.state) && !activeNews.length;
        const canModerate = a.state === 'rendered' && jobDone && ['pending', 'upload_failed'].includes(a.job?.approvalStatus ?? '');

        return (
          <Card key={a.id} className={`gap-0 py-4 ${isSkipped ? 'opacity-60' : ''}`}>
            <CardHeader className="px-4 pb-2">
              <CardTitle className="flex flex-wrap items-start gap-x-2 gap-y-1 text-[14px] leading-snug">
                <span className="min-w-0 flex-1">{a.title}</span>
                <span className={`inline-flex shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-bold ${state.cls}`}>
                  {state.text}
                </span>
              </CardTitle>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                {a.publishedAt && <span>{new Date(a.publishedAt).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}
                {caseNo(a) && <span className="font-mono">дело {caseNo(a)}</span>}
                <a href={a.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-primary hover:underline">
                  domdara.org <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </CardHeader>
            <CardContent className="space-y-3 px-4">
              {/* Превью 4 слайдов */}
              {!isSkipped && (
                <div className="grid grid-cols-4 gap-2">
                  {slides.map((s, i) => (
                    <SlideCard key={s.label} icon={s.icon} label={s.label} text={s.text} i={i} />
                  ))}
                </div>
              )}

              {/* Сценарий + аудио озвучки */}
              {jobDone && a.job && (
                <div className="space-y-2 rounded-2xl border border-hairline bg-black/[0.02] p-3 dark:bg-white/[0.04]">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Сценарий 45 c · голос OstapNeural · караоке-субтитры
                  </p>
                  <p className="text-[12.5px] leading-relaxed">
                    <b>Хук:</b> {String(safeParams(a.job.params).hook ?? slides[0].text)}
                  </p>
                  <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                    <b>Вывод:</b> {String(safeParams(a.job.params).conclusion ?? slides[3].text).slice(0, 200)}
                  </p>
                  <audio controls preload="none" src="/demo/news_narration.mp3" className="h-9 w-full" />
                </div>
              )}

              {/* Действия */}
              <div className="flex flex-wrap gap-2">
                {canGenerate && (
                  <Button
                    size="sm"
                    className="h-9 rounded-full text-[12.5px] font-semibold"
                    disabled={busy === a.id}
                    onClick={() => act({ action: 'generate', articleId: a.id }, '⚡ Поставлена в фоновую очередь', 'Zero-Conflict: выполнится после задач друзей')}
                  >
                    {busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
                    Смонтировать Shorts из новости
                  </Button>
                )}
                {canModerate && (
                  <>
                    <Button
                      size="sm"
                      className="h-9 rounded-full bg-[#30d158] text-[12.5px] font-semibold text-white hover:bg-[#2ab84e]"
                      disabled={busy === a.job!.id}
                      onClick={() => act({ action: 'approve', jobId: a.job!.id }, '✅ Одобрено', 'Выгрузка на YouTube (private) запущена')}
                    >
                      <BadgeCheck className="h-3.5 w-3.5" />
                      Одобрить → YouTube (private)
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 rounded-full text-[12.5px]"
                      disabled={busy === a.job!.id}
                      onClick={() => act({ action: 'regenerate', jobId: a.job!.id }, '✏️ Перегенерация', 'Новая подача сценария (priority=10)')}
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                      Перегенерировать
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-9 rounded-full text-[12.5px] text-destructive hover:text-destructive"
                      disabled={busy === a.job!.id}
                      onClick={() => act({ action: 'reject', jobId: a.job!.id }, '❌ Отклонено', 'Файлы удалены, статья помечена')}
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      Отклонить
                    </Button>
                  </>
                )}
                {a.job?.approvalStatus === 'uploaded' && (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#30d158]/15 px-3 py-1.5 text-[11.5px] font-semibold text-[#30d158]">
                    <BadgeCheck className="h-3.5 w-3.5" />
                    Выгружено: youtu.be/{String(safeParams(a.job.params).youtube_video_id ?? '')}
                  </span>
                )}
                {isSkipped && (
                  <p className="text-[12px] text-muted-foreground">
                    Пропущено фильтром качества: фото-пост или текст &lt; 200 символов.
                  </p>
                )}
              </div>

              {/* Ссылка на прогресс задачи */}
              {a.job && ['queued', 'processing'].includes(a.job.status) && (
                <p className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <PlayCircle className="h-3.5 w-3.5" />
                  Задача #{a.job.id.slice(0, 8)} · {a.job.type} · {a.job.stageLabel ?? 'в очереди'}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}

      {articles.length === 0 && (
        <Card className="gap-0 py-8">
          <CardContent className="text-center text-[13px] text-muted-foreground">
            Статьи не загружены — фоновый планировщик опрашивает RSS каждые 4 часа в idle-такте воркера.
          </CardContent>
        </Card>
      )}
    </div>
  );
}
