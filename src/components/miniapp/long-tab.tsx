'use client';

// Вкладка «Монтаж Long»: длинные записи, вырезка пауз, главы, обложка 1280×720

import { useState } from 'react';
import { AudioLines, Captions, Hourglass, Loader2, Timer } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api } from '@/lib/client-api';
import { hapticSuccess, hapticTap } from '@/lib/telegram-client';
import type { LongParams, User } from '@/lib/types';
import { DEFAULT_LONG } from '@/lib/types';
import { SourcePicker, type SourceMode } from '@/components/miniapp/source-picker';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

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
    <div className="space-y-4 pb-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Hourglass className="h-4.5 w-4.5 text-primary" />
            Монтаж Long · 1280×720
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Заседания, лекции: транскрипция Whisper, аудит пауз, склейка без перекодирования
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          <SourcePicker mode={mode} onModeChange={setMode} file={file} onFileChange={setFile} url={url} onUrlChange={setUrl} />

          {/* Чувствительность вырезки пауз */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Timer className="h-4 w-4 text-primary" /> Вырезка пауз и тишины
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <Label className="text-xs text-muted-foreground">Вырезать паузы длиннее</Label>
                <span className="text-sm font-semibold text-primary tabular-nums">{params.max_gap.toFixed(1)} сек</span>
              </div>
              <Slider
                value={[params.max_gap]}
                onValueChange={([v]) => set('max_gap', v)}
                min={0.5}
                max={10}
                step={0.5}
                aria-label="Порог вырезки пауз, секунды"
              />
              <div className="flex items-center justify-between text-sm">
                <Label className="text-xs text-muted-foreground">Отступ при склейке (pad)</Label>
                <span className="text-sm font-semibold text-primary tabular-nums">{params.pad.toFixed(1)} сек</span>
              </div>
              <Slider
                value={[params.pad]}
                onValueChange={([v]) => set('pad', v)}
                min={0.2}
                max={2}
                step={0.1}
                aria-label="Отступ при склейке, секунды"
              />
              <p className="text-[11px] text-muted-foreground">
                audit_gaps.py найдёт все тишины длиннее порога; чем меньше порог — тем динамичнее (и дольше рендер).
              </p>
            </div>
          </div>

          {/* Модель и главы */}
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <AudioLines className="h-4 w-4 text-primary" /> Транскрипция и главы
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Модель Whisper</Label>
              <Select value={params.whisper_model} onValueChange={(v) => set('whisper_model', v)}>
                <SelectTrigger aria-label="Модель Whisper"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="small">small — быстрее, экономит ОЗУ</SelectItem>
                  <SelectItem value="large-v3-turbo">large-v3-turbo — точнее (рекомендуется)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5 cursor-pointer">
              <span className="text-sm">
                Главы и таймкоды
                <span className="block text-xs text-muted-foreground">00:00 Початок засідання · … в описании YouTube</span>
              </span>
              <Switch checked={params.chapters} onCheckedChange={(v) => { hapticTap(); set('chapters', v); }} aria-label="Генерировать главы" />
            </label>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Название для YouTube (необязательно)</Label>
              <Input
                value={params.meta_title}
                onChange={(e) => set('meta_title', e.target.value)}
                placeholder="Судове засідання у Запоріжжі"
                maxLength={100}
                aria-label="Название видео для YouTube"
              />
            </div>
          </div>

          <Button className="w-full h-11 text-sm font-semibold" onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Поставить в очередь рендера'}
          </Button>
          <div className="rounded-lg bg-muted/50 border border-border p-3 flex items-start gap-2">
            <Captions className="h-4 w-4 text-primary mt-0.5 shrink-0" />
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              Конвейер: <span className="text-foreground font-medium">audio16k.wav → whisper → audit_gaps → render_segments.py (по одному сегменту) → concat -c copy</span>.
              Публикация на YouTube — private по умолчанию, с обложкой 1280×720.
            </p>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Использовано сегодня: {user.dailyUsed}/{user.dailyLimit} задач
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
