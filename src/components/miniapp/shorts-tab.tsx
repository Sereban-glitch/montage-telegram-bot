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

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1.5 text-[12px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
      {children}
    </p>
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
    <div className="space-y-6 pb-6">
      {/* Заголовок экрана */}
      <div className="space-y-1 px-1">
        <h2 className="text-[26px] font-bold leading-tight tracking-tight">Монтаж Shorts</h2>
        <p className="text-[13px] text-muted-foreground">
          Вертикаль 1080×1920 · субтитры 2–3 строки · нормализация EBU R128
        </p>
      </div>

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
                Двуязычный режим
                <span className="block text-[11px] font-normal text-muted-foreground">
                  Речь українською → русские субтитры
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
        <GroupLabel>Кадр обложки · 1080×1920</GroupLabel>
        <Card className="gap-0 py-4">
          <CardContent className="space-y-4 px-4">
            <div className="relative mx-auto aspect-[9/16] w-[46%] overflow-hidden rounded-3xl shadow-float ring-1 ring-black/10 dark:ring-white/15">
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
              <div className="absolute inset-x-0 top-0 bg-gradient-to-b from-black/75 via-black/35 to-transparent p-3 pb-6">
                <p className="text-[10px] font-bold uppercase leading-tight tracking-wide text-white">
                  {(params.title_line1 || 'ВЕРХНИЙ ТИТУЛ') + (params.title_line2 ? ` ${params.title_line2}` : '')}
                </p>
                <p className="mt-0.5 text-[9px] text-white/85">{params.overlay_label || 'КСУ • дата'}</p>
              </div>
              <div className="absolute inset-x-3 bottom-3 flex justify-center">
                <span className="rounded-full bg-primary px-2.5 py-1 text-[8.5px] font-bold uppercase tracking-wider text-white shadow-glow">
                  {params.pill_text || 'плашка'}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-muted-foreground">Позиция кадра</Label>
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
                сек — длина клипа для расчёта таймкода кадра
              </span>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* CTA */}
      <div className="space-y-3 pt-1">
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
        <div className="flex items-start gap-2 rounded-2xl border border-hairline bg-card/60 px-3.5 py-3">
          <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Конвейер: <span className="font-medium text-foreground">whisper → нарезка → render_short.py → thumb_short.py → loudnorm I=-14</span>.
            Прогресс — во вкладке «Задачи», уведомления приходят в Telegram.
          </p>
        </div>
      </div>

    </div>
  );
}
