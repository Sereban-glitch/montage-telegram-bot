'use client';

// Вкладка «Монтаж Shorts»: загрузка, титулы, субтитры, кадр обложки.
// Дизайн: inset grouped секции iOS + System Blue CTA.

import { useState } from 'react';
import { Cpu, Languages, Loader2, Type } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api, fmtDuration } from '@/lib/client-api';
import { hapticSuccess, hapticTap } from '@/lib/telegram-client';
import type { ShortsParams, User } from '@/lib/types';
import { DEFAULT_SHORTS } from '@/lib/types';
import { SourcePicker, type SourceMode } from '@/components/miniapp/source-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

const LANGS = [
  { value: 'uk', label: 'Украинская' },
  { value: 'ru', label: 'Русская' },
  { value: 'en', label: 'English' },
];

const SUBS = [
  { value: 'ru', label: 'Русские' },
  { value: 'uk', label: 'Украинские' },
  { value: 'en', label: 'English' },
  { value: 'off', label: 'Без субтитров' },
];

// Пример строки субтитров для превью — по выбранному языку
const SUB_SAMPLE: Record<string, string> = {
  ru: 'Сегодня рассматривается дело о выделении земли',
  uk: 'Сьогодні розглядається справа про виділення землі',
  en: 'Today the council hears the land case',
};

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1.5 text-[12px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
      {children}
    </p>
  );
}

// Живой предпросмотр кадра обложки 1080×1920: титул, плашка-лейбл,
// пример субтитров с учётом двуязычного режима и пилюля.
function CoverPreview({
  params,
  size,
  className,
}: {
  params: ShortsParams;
  size: 'sm' | 'lg';
  className?: string;
}) {
  const lg = size === 'lg';
  const subsOn = params.subtitle_lang !== 'off';
  const main = subsOn ? SUB_SAMPLE[params.subtitle_lang] : undefined;
  const secondary = params.bilingual && subsOn ? SUB_SAMPLE[params.speech_lang] : undefined;

  return (
    <div
      className={`relative aspect-[9/16] overflow-hidden rounded-3xl shadow-float ring-1 ring-black/10 transition-all duration-300 hover:ring-primary/45 dark:ring-white/15 ${
        className ?? ''
      }`}
    >
      <div
        className="absolute inset-0 bg-cover bg-no-repeat"
        style={{
          backgroundImage: "url('/showcase/short-court.png')",
          backgroundPosition: `50% ${params.cover_frame}%`,
          backgroundSize: '160% auto',
        }}
        role="img"
        aria-label="Предпросмотр кадра обложки"
      />
      <div
        className={`absolute inset-x-0 top-0 bg-gradient-to-b from-black/75 via-black/35 to-transparent ${
          lg ? 'p-4 pb-8' : 'p-3 pb-6'
        }`}
      >
        <p
          className={`${
            lg ? 'text-[15px]' : 'text-[10px]'
          } font-bold uppercase leading-tight tracking-wide text-white`}
        >
          {(params.title_line1 || 'ВЕРХНИЙ ТИТУЛ') + (params.title_line2 ? ` ${params.title_line2}` : '')}
        </p>
        <p className={`mt-0.5 text-white/85 ${lg ? 'text-[10.5px]' : 'text-[9px]'}`}>
          {params.overlay_label || 'КСУ • дата'}
        </p>
      </div>
      {main && (
        <div
          className={`absolute space-y-1 text-center ${lg ? 'inset-x-4 bottom-[20%]' : 'inset-x-2 bottom-[18%]'}`}
        >
          <p
            className={`mx-auto w-fit max-w-full rounded-xl bg-black/70 px-2.5 py-1.5 font-medium leading-snug text-white ${
              lg ? 'text-[13px]' : 'text-[9.5px]'
            }`}
          >
            {main}
          </p>
          {secondary && (
            <p
              className={`mx-auto w-fit max-w-full rounded-xl bg-black/55 px-2 py-1 leading-snug text-white/80 ${
                lg ? 'block text-[10.5px]' : 'block text-[8px]'
              }`}
            >
              {secondary}
            </p>
          )}
        </div>
      )}
      <div className="absolute inset-x-3 bottom-3 flex justify-center">
        <span
          className={`rounded-full bg-primary font-bold uppercase tracking-wider text-white shadow-glow ${
            lg ? 'px-3.5 py-1.5 text-[11px]' : 'px-2.5 py-1 text-[8.5px]'
          }`}
        >
          {params.pill_text || 'плашка'}
        </span>
      </div>
    </div>
  );
}

export function ShortsTab({ user, onCreated }: { user: User; onCreated: () => void }) {
  const [mode, setMode] = useState<SourceMode>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [params, setParams] = useState<ShortsParams>({ ...DEFAULT_SHORTS });
  const [clipLength, setClipLength] = useState(60); // демо-длительность для таймкодов обложки
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof ShortsParams>(k: K, v: ShortsParams[K]) =>
    setParams((p) => ({ ...p, [k]: v }));

  const coverTimecode = fmtDuration(Math.max(1, Math.round((clipLength * params.cover_frame) / 100)));

  const submit = async () => {
    hapticTap();
    if (mode === 'upload' && !file) {
      toast({ title: 'Прикрепите видеофайл', variant: 'destructive' });
      return;
    }
    if (mode !== 'upload' && !url.trim()) {
      toast({ title: 'Вставьте ссылку на видео', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set('type', 'short');
      form.set('sourceType', mode);
      form.set('sourceUrl', mode === 'upload' ? '' : url.trim());
      form.set('params', JSON.stringify(params));
      if (mode === 'upload' && file) form.set('file', file);

      await api<{ job: { id: string } }>('/api/jobs', { method: 'POST', body: form });
      hapticSuccess();
      toast({
        title: 'Задача в очереди 🎬',
        description: 'Бот пришлёт статусы: транскрипция → рендер → готово',
      });
      setFile(null);
      setUrl('');
      setParams({ ...DEFAULT_SHORTS });
      onCreated();
    } catch (e) {
      toast({ title: 'Не удалось поставить задачу', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="md:grid md:grid-cols-[minmax(0,1fr)_360px] md:items-start md:gap-7 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-6 pb-6">
      {/* Заголовок экрана */}
      <div className="space-y-1 px-1">
        <h2 className="text-[26px] font-bold leading-tight tracking-tight">Монтаж Shorts</h2>
        <p className="text-[13px] text-muted-foreground">
          Вертикаль 1080×1920 · сочный ТВ-звук EBU R128 · субтитры с автовыравниванием
        </p>
      </div>

      {/* Готовые пресеты в 1 клик для новичков */}
      <section className="space-y-2">
        <GroupLabel>Готовые стили в 1 клик (для чайников и профи)</GroupLabel>
        <div className="grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => {
              hapticTap();
              setParams((p) => ({
                ...p,
                title_line1: 'ШОК! ВЫ НЕ ПОВЕРИТЕ',
                title_line2: 'СМОТРИ ДО КОНЦА',
                pill_text: 'ВИРУСНЫЙ ХИТ 🔥',
                overlay_label: 'YouTube Shorts',
                bilingual: true,
                speech_lang: 'uk',
                subtitle_lang: 'ru',
              }));
              toast({ title: 'Пресет применён 🔥', description: 'Вирусный Shorts: золотой стиль + укр/рус субтитры' });
            }}
            className="flex flex-col items-center gap-1 rounded-2xl border border-hairline bg-card p-3 text-center transition-all hover:border-primary/50 hover:bg-primary/[0.04] active:scale-95"
          >
            <span className="text-xl">🔥</span>
            <span className="text-[12px] font-bold">Вирусный Shorts</span>
            <span className="text-[10px] text-muted-foreground">Макс. охват</span>
          </button>

          <button
            type="button"
            onClick={() => {
              hapticTap();
              setParams((p) => ({
                ...p,
                title_line1: 'СУДОВИЙ ПРЕЦЕДЕНТ',
                title_line2: 'ВЕРХОВНИЙ СУД',
                pill_text: 'ЗАХИСТ ПРАВ ⚖️',
                overlay_label: 'Свободные Люди Запорожья',
                bilingual: true,
                speech_lang: 'uk',
                subtitle_lang: 'ru',
              }));
              toast({ title: 'Пресет применён ⚖️', description: 'Суд и Закон: солидная карточка дела + подложка' });
            }}
            className="flex flex-col items-center gap-1 rounded-2xl border border-hairline bg-card p-3 text-center transition-all hover:border-primary/50 hover:bg-primary/[0.04] active:scale-95"
          >
            <span className="text-xl">⚖️</span>
            <span className="text-[12px] font-bold">Суд и Закон</span>
            <span className="text-[10px] text-muted-foreground">Правозащита</span>
          </button>

          <button
            type="button"
            onClick={() => {
              hapticTap();
              setParams((p) => ({
                ...p,
                title_line1: 'ГЛАВНЫЙ ИНСАЙТ',
                title_line2: 'ЭТО ВАЖНО ЗНАТЬ',
                pill_text: 'ИНТЕРВЬЮ 🎙️',
                overlay_label: 'Подкаст',
                bilingual: false,
                speech_lang: 'uk',
                subtitle_lang: 'uk',
              }));
              toast({ title: 'Пресет применён 🎙️', description: 'Подкаст: чистый звук + автонарезка' });
            }}
            className="flex flex-col items-center gap-1 rounded-2xl border border-hairline bg-card p-3 text-center transition-all hover:border-primary/50 hover:bg-primary/[0.04] active:scale-95"
          >
            <span className="text-xl">🎙️</span>
            <span className="text-[12px] font-bold">Подкаст / Блог</span>
            <span className="text-[10px] text-muted-foreground">Интервью</span>
          </button>
        </div>
      </section>

      {/* Источник */}
      <section className="space-y-2" aria-label="Источник видео">
        <GroupLabel>Источник</GroupLabel>
        <Card className="gap-0 py-4">
          <CardContent className="px-4">
            <SourcePicker mode={mode} onModeChange={setMode} file={file} onFileChange={setFile} url={url} onUrlChange={setUrl} />
          </CardContent>
        </Card>
      </section>

      {/* Титры и плашка */}
      <section className="space-y-2" aria-label="Титры и плашка">
        <GroupLabel>Титры и плашка</GroupLabel>
        <Card className="gap-0 py-4">
          <CardContent className="space-y-3.5 px-4">
            <div className="grid grid-cols-2 gap-2.5">
              <Input
                value={params.title_line1}
                onChange={(e) => set('title_line1', e.target.value)}
                placeholder="Титул · строка 1"
                maxLength={40}
                aria-label="Титул, строка 1"
              />
              <Input
                value={params.title_line2}
                onChange={(e) => set('title_line2', e.target.value)}
                placeholder="Титул · строка 2"
                maxLength={40}
                aria-label="Титул, строка 2"
              />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Input
                value={params.overlay_label}
                onChange={(e) => set('overlay_label', e.target.value)}
                placeholder="КСУ • 29.09.2026"
                maxLength={30}
                aria-label="Плашка-лейбл"
              />
              <Input
                value={params.pill_text}
                onChange={(e) => set('pill_text', e.target.value)}
                placeholder="ЩО ЦЕ ЗМІНЮЄ?"
                maxLength={30}
                aria-label="Текст пилюли на обложке"
              />
            </div>
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Type className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              Титул рендерится сверху кадра, плашка — на обложке 1080×1920.
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Субтитры */}
      <section className="space-y-2" aria-label="Субтитры">
        <GroupLabel>Субтитры</GroupLabel>
        <Card className="gap-0 py-4">
          <CardContent className="space-y-3.5 px-4">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1.5">
                <Label className="text-[12px] text-muted-foreground">Язык речи</Label>
                <Select value={params.speech_lang} onValueChange={(v) => set('speech_lang', v)}>
                  <SelectTrigger aria-label="Язык речи" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANGS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px] text-muted-foreground">Язык субтитров</Label>
                <Select value={params.subtitle_lang} onValueChange={(v) => set('subtitle_lang', v)}>
                  <SelectTrigger aria-label="Язык субтитров" className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SUBS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl bg-black/[0.025] px-3.5 py-3 dark:bg-white/[0.04]">
              <span className="text-[13px] font-medium leading-snug">
                🇺🇦➡️🇷🇺 Двуязычный режим (в 3–4 раза больше просмотров)
                <span className="block text-[11px] font-normal text-muted-foreground">
                  Спикер говорит українською ➡️ субтитры крупно на русском на подложке
                </span>
              </span>
              <Switch
                checked={params.bilingual}
                onCheckedChange={(v) => {
                  hapticTap();
                  set('bilingual', v);
                }}
                aria-label="Двуязычный режим субтитров"
              />
            </label>
          </CardContent>
        </Card>
      </section>

      {/* Обложка */}
      <section className="space-y-2" aria-label="Кадр обложки">
        <GroupLabel>🖼️ Кликбейтный стоп-кадр для обложки (1080×1920)</GroupLabel>
        <Card className="gap-0 py-4">
          <CardContent className="space-y-4 px-4">
            <CoverPreview params={params} size="sm" className="mx-auto w-[46%] md:hidden" />

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-muted-foreground">Секунда кадра с эмоцией лица</Label>
                <span className="rounded-full bg-primary/12 px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-primary dark:bg-primary/20">
                  {coverTimecode}
                </span>
              </div>
              <Slider
                value={[params.cover_frame]}
                onValueChange={([v]) => set('cover_frame', v)}
                min={0}
                max={100}
                step={1}
                aria-label="Позиция кадра обложки"
              />
            </div>

            <div className="flex items-center gap-2.5 rounded-2xl bg-black/[0.025] px-3.5 py-2.5 dark:bg-white/[0.04]">
              <Input
                type="number"
                min={5}
                max={3600}
                value={clipLength}
                onChange={(e) => setClipLength(Number(e.target.value) || 0)}
                className="h-9 w-24 text-[13px] tabular-nums"
                aria-label="Длительность клипа, сек"
              />
              <span className="text-[11px] leading-snug text-muted-foreground">
                сек — общая длина видео для расчёта таймкода
              </span>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* CTA — мобильная версия (на десктопе кнопка в панели предпросмотра) */}
      <div className="space-y-3 pt-1 md:hidden">
        <Button size="lg" className="h-[52px] w-full text-[15px]" onClick={submit} disabled={submitting}>
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : '🚀 Смонтировать в 1 клик'}
        </Button>
        <p className="text-center text-[12px] text-muted-foreground">
          Осталось сегодня:{' '}
          <span className="font-semibold tabular-nums text-foreground">
            {user.dailyLimit - user.dailyUsed} из {user.dailyLimit}
          </span>{' '}
          задач · готовый Shorts прилетит в Telegram
        </p>
        <div className="flex items-start gap-2 rounded-2xl border border-hairline bg-card/60 px-3.5 py-3">
          <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            🔊 <span className="font-medium text-foreground">Сочный ТВ-звук EBU R128</span> + золотая рамка + пословные субтитры DejaVu Sans Bold.
          </p>
        </div>
      </div>

      </div>

      {/* Desktop-панель предпросмотра: большой кадр 1080×1920 + кнопка запуска */}
      <aside className="hidden md:sticky md:top-24 md:block" aria-label="Предпросмотр кадра обложки">
        <div className="space-y-4 rounded-3xl border border-hairline bg-card/70 p-5 shadow-soft">
          <div className="flex items-center justify-between px-1">
            <p className="text-[12px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
              Предпросмотр 1080×1920
            </p>
            <span className="rounded-full bg-primary/12 px-2.5 py-0.5 font-mono text-[11px] font-semibold tabular-nums text-primary dark:bg-primary/20">
              {coverTimecode}
            </span>
          </div>

          <CoverPreview params={params} size="lg" className="mx-auto w-full max-w-[300px] xl:max-w-[340px]" />

          {/* Мини-трек позиции кадра */}
          <div
            className="relative mx-auto h-1 w-full max-w-[300px] rounded-full bg-black/10 xl:max-w-[340px] dark:bg-white/15"
            aria-hidden
          >
            <span
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary shadow-glow"
              style={{ left: `${params.cover_frame}%` }}
            />
          </div>

          <Button size="lg" className="h-[52px] w-full text-[15px]" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : 'Поставить в очередь рендера'}
          </Button>

          <p className="text-center text-[12px] text-muted-foreground">
            Использовано сегодня:{' '}
            <span className="font-semibold tabular-nums text-foreground">
              {user.dailyUsed}/{user.dailyLimit}
            </span>{' '}
            задач · бот пришлёт final.mp4 в чат
          </p>

          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <Cpu className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            whisper → нарезка → render_short.py → loudnorm I=-14 · прогресс во вкладке «Задачи»
          </p>
        </div>
      </aside>
    </div>
  );
}
