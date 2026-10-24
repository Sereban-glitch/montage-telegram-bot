'use client';

// Вкладка «Монтаж Long»: длинные записи, вырезка пауз, главы, обложка 1280×720.
// Дизайн: inset grouped секции iOS + слайдеры в стиле Apple.

import { useState } from 'react';
import { Captions, Cpu, Loader2, Timer } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api } from '@/lib/client-api';
import { hapticSuccess, hapticTap } from '@/lib/telegram-client';
import type { LongParams, User } from '@/lib/types';
import { DEFAULT_LONG } from '@/lib/types';
import { SourcePicker, type SourceMode } from '@/components/miniapp/source-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="px-1.5 text-[12px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
      {children}
    </p>
  );
}

export function LongTab({ user, onCreated }: { user: User; onCreated: () => void }) {
  const [mode, setMode] = useState<SourceMode>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [params, setParams] = useState<LongParams>({ ...DEFAULT_LONG });
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof LongParams>(k: K, v: LongParams[K]) =>
    setParams((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    hapticTap();
    if (mode === 'upload' && !file) {
      toast({ title: 'Прикрепите длинное видео или аудио', variant: 'destructive' });
      return;
    }
    if (mode !== 'upload' && !url.trim()) {
      toast({ title: 'Вставьте ссылку на запись', variant: 'destructive' });
      return;
    }
    setSubmitting(true);
    try {
      const form = new FormData();
      form.set('type', 'long');
      form.set('sourceType', mode);
      form.set('sourceUrl', mode === 'upload' ? '' : url.trim());
      form.set('params', JSON.stringify(params));
      if (mode === 'upload' && file) form.set('file', file);

      await api<{ job: { id: string } }>('/api/jobs', { method: 'POST', body: form });
      hapticSuccess();
      toast({
        title: 'Long-задача в очереди ⏳',
        description: 'Сегментный рендер бережёт 12 ГБ ОЗУ сервера',
      });
      setFile(null);
      setUrl('');
      setParams({ ...DEFAULT_LONG });
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
        <h2 className="text-[26px] font-bold leading-tight tracking-tight">Монтаж Long</h2>
        <p className="text-[13px] text-muted-foreground">
          Заседания и лекции 1280×720 · транскрипция Whisper · склейка без перекодирования
        </p>
      </div>

      {/* Источник */}
      <section className="space-y-2" aria-label="Источник записи">
        <GroupLabel>Источник</GroupLabel>
        <Card className="gap-0 py-4">
          <CardContent className="px-4">
            <SourcePicker mode={mode} onModeChange={setMode} file={file} onFileChange={setFile} url={url} onUrlChange={setUrl} />
          </CardContent>
        </Card>
      </section>

      {/* Паузы и тишина */}
      <section className="space-y-2" aria-label="Вырезка пауз">
        <GroupLabel>Вырезка пауз и тишины</GroupLabel>
        <Card className="gap-0 py-4">
          <CardContent className="space-y-5 px-4">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <Label className="text-[13px] font-medium">Паузы длиннее</Label>
                <span className="rounded-full bg-primary/12 px-2.5 py-0.5 text-[13px] font-bold tabular-nums text-primary dark:bg-primary/20">
                  {params.max_gap.toFixed(1)} сек
                </span>
              </div>
              <Slider
                value={[params.max_gap]}
                onValueChange={([v]) => set('max_gap', v)}
                min={0.5}
                max={10}
                step={0.5}
                aria-label="Порог вырезки пауз, секунды"
              />
            </div>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <Label className="text-[13px] font-medium">Отступ при склейке</Label>
                <span className="rounded-full bg-primary/12 px-2.5 py-0.5 text-[13px] font-bold tabular-nums text-primary dark:bg-primary/20">
                  {params.pad.toFixed(1)} сек
                </span>
              </div>
              <Slider
                value={[params.pad]}
                onValueChange={([v]) => set('pad', v)}
                min={0.2}
                max={2}
                step={0.1}
                aria-label="Отступ при склейке, секунды"
              />
            </div>
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Timer className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              audit_gaps.py найдёт все тишины длиннее порога; чем меньше порог — тем динамичнее (и дольше рендер).
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Транскрипция и главы */}
      <section className="space-y-2" aria-label="Транскрипция и главы">
        <GroupLabel>Транскрипция и главы</GroupLabel>
        <Card className="gap-0 py-4">
          <CardContent className="space-y-3.5 px-4">
            <div className="space-y-1.5">
              <Label className="text-[12px] text-muted-foreground">Модель Whisper</Label>
              <Select value={params.whisper_model} onValueChange={(v) => set('whisper_model', v)}>
                <SelectTrigger aria-label="Модель Whisper" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="small">small — быстрее, экономит ОЗУ</SelectItem>
                  <SelectItem value="large-v3-turbo">large-v3-turbo — точнее (рекомендуется)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl bg-black/[0.025] px-3.5 py-3 dark:bg-white/[0.04]">
              <span className="text-[13px] font-medium leading-snug">
                Главы и таймкоды
                <span className="block text-[11px] font-normal text-muted-foreground">
                  00:00 Початок засідання · … в описании YouTube
                </span>
              </span>
              <Switch checked={params.chapters} onCheckedChange={(v) => { hapticTap(); set('chapters', v); }} aria-label="Генерировать главы" />
            </label>
            <div className="space-y-1.5">
              <Label className="text-[12px] text-muted-foreground">Название для YouTube (необязательно)</Label>
              <Input
                value={params.meta_title}
                onChange={(e) => set('meta_title', e.target.value)}
                placeholder="Судове засідання у Запоріжжі"
                maxLength={100}
                aria-label="Название видео для YouTube"
              />
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
          задач
        </p>
        <div className="flex items-start gap-2 rounded-2xl border border-hairline bg-card/60 px-3.5 py-3">
          <Cpu className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            Конвейер: <span className="font-medium text-foreground">audio16k.wav → whisper → audit_gaps → render_segments.py (по одному сегменту) → concat -c copy</span>.
            Публикация на YouTube — private по умолчанию, с обложкой 1280×720.
          </p>
        </div>
        <p className="flex items-start gap-1.5 px-1 text-[11px] leading-relaxed text-muted-foreground">
          <Captions className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          Субтитры и главы генерируются из транскрипции автоматически.
        </p>
      </div>
    </div>
  );
}
