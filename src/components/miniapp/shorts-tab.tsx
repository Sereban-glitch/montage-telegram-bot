'use client';

// Вкладка «Монтаж Shorts»: загрузка, титулы, субтитры, кадр обложки

import { useState } from 'react';
import { Clapperboard, Languages, Loader2, Sparkles, Type } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api, fmtDuration } from '@/lib/client-api';
import { hapticSuccess, hapticTap } from '@/lib/telegram-client';
import type { ShortsParams, User } from '@/lib/types';
import { DEFAULT_SHORTS } from '@/lib/types';
import { SourcePicker, type SourceMode } from '@/components/miniapp/source-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
    <div className="space-y-4 pb-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Clapperboard className="h-4.5 w-4.5 text-primary" />
            Монтаж Shorts · 1080×1920
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Динамичная нарезка, 2–3 строчные субтитры по пикселям DejaVu Sans, нормализация EBU R128
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <SourcePicker mode={mode} onModeChange={setMode} file={file} onFileChange={setFile} url={url} onUrlChange={setUrl} />

          {/* Верхний титул и плашка */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Type className="h-4 w-4 text-primary" /> Верхний титул и плашка
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Input
                value={params.title_line1}
                onChange={(e) => set('title_line1', e.target.value)}
                placeholder="Строка титула 1"
                maxLength={40}
                aria-label="Титул, строка 1"
              />
              <Input
                value={params.title_line2}
                onChange={(e) => set('title_line2', e.target.value)}
                placeholder="Строка титула 2"
                maxLength={40}
                aria-label="Титул, строка 2"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
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
          </div>

          {/* Субтитры */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Languages className="h-4 w-4 text-primary" /> Субтитры
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Язык речи</Label>
                <Select value={params.speech_lang} onValueChange={(v) => set('speech_lang', v)}>
                  <SelectTrigger aria-label="Язык речи"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANGS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Язык субтитров</Label>
                <Select value={params.subtitle_lang} onValueChange={(v) => set('subtitle_lang', v)}>
                  <SelectTrigger aria-label="Язык субтитров"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SUBS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5 cursor-pointer">
              <span className="text-sm">
                Двуязычный режим
                <span className="block text-xs text-muted-foreground">Речь українською → русские субтитры</span>
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
          </div>

          {/* Кадр обложки */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Sparkles className="h-4 w-4 text-primary" /> Кадр для обложки 1080×1920
              </div>
              <span className="text-xs font-mono text-primary bg-primary/10 rounded px-1.5 py-0.5">{coverTimecode}</span>
            </div>
            <div className="relative overflow-hidden rounded-xl border border-border aspect-[9/16] max-h-64 mx-auto w-[45%]">
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
              <div className="absolute inset-x-0 top-0 p-2.5 bg-gradient-to-b from-black/70 to-transparent">
                <p className="text-white text-[10px] font-bold leading-tight uppercase">
                  {(params.title_line1 || 'ВЕРХНИЙ ТИТУЛ') + (params.title_line2 ? ` ${params.title_line2}` : '')}
                </p>
                <p className="text-white/80 text-[9px]">{params.overlay_label || 'КСУ • дата'}</p>
              </div>
              <div className="absolute inset-x-2 bottom-2 flex justify-center">
                <span className="bg-primary text-primary-foreground text-[8px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wide">
                  {params.pill_text || 'плашка'}
                </span>
              </div>
            </div>
            <Slider
              value={[params.cover_frame]}
              onValueChange={([v]) => set('cover_frame', v)}
              min={0}
              max={100}
              step={1}
              aria-label="Позиция кадра обложки"
            />
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={5}
                max={3600}
                value={clipLength}
                onChange={(e) => setClipLength(Number(e.target.value) || 0)}
                className="h-9 w-28 text-xs"
                aria-label="Длительность клипа, сек"
              />
              <span className="text-xs text-muted-foreground">сек — длина клипа для таймкода кадра</span>
            </div>
          </div>

          <Button className="w-full h-11 text-sm font-semibold" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Поставить в очередь рендера'}
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            Использовано сегодня: {user.dailyUsed}/{user.dailyLimit} задач · бот пришлёт final.mp4 в чат
          </p>
          <div className="rounded-lg bg-muted/50 border border-border p-3">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Движок выполнит: <span className="text-foreground font-medium">whisper → нарезка → render_short.py → thumb_short.py → loudnorm I=-14</span>.
              Прогресс видно во вкладке «Задачи», уведомления приходят в Telegram.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
