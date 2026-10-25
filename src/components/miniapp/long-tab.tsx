'use client';

// Вкладка «Монтаж Long»: длинные записи, вырезка пауз, главы, обложка 1280×720.
// Дизайн: inset grouped секции iOS + слайдеры в стиле Apple + человеческая микрокопия.

import { useState } from 'react';
import { Captions, Loader2 } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api } from '@/lib/client-api';
import { hapticSuccess, hapticTap } from '@/lib/telegram-client';
import { useI18n } from '@/lib/i18n';
import type { LongParams, User } from '@/lib/types';
import { DEFAULT_LONG } from '@/lib/types';
import { SourcePicker, type SourceMode } from '@/components/miniapp/source-picker';
import { OnboardingSteps } from '@/components/miniapp/onboarding-steps';
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
  const { t } = useI18n();
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
      toast({ title: t.long.needFile, variant: 'destructive' });
      return;
    }
    if (mode !== 'upload' && !url.trim()) {
      toast({ title: t.long.needUrl, variant: 'destructive' });
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
        title: t.long.queuedTitle,
        description: t.long.queuedDesc,
      });
      setFile(null);
      setUrl('');
      setParams({ ...DEFAULT_LONG });
      onCreated();
    } catch (e) {
      toast({
        title: t.long.failQueue,
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-6">
      {/* Закреплённый онбординг «3 шага» */}
      <OnboardingSteps />

      {/* Заголовок экрана */}
      <div className="space-y-1 px-1">
        <h2 className="text-[26px] font-bold leading-tight tracking-tight">{t.long.title}</h2>
        <p className="text-[13px] text-muted-foreground">{t.long.subtitle}</p>
      </div>

      {/* Источник */}
      <section className="space-y-2" aria-label={t.long.groupSource}>
        <GroupLabel>{t.long.groupSource}</GroupLabel>
        <Card className="gap-0 py-4">
          <CardContent className="px-4">
            <SourcePicker mode={mode} onModeChange={setMode} file={file} onFileChange={setFile} url={url} onUrlChange={setUrl} />
          </CardContent>
        </Card>
      </section>

      {/* Паузы и тишина */}
      <section className="space-y-2" aria-label={t.long.groupGaps}>
        <GroupLabel>{t.long.groupGaps}</GroupLabel>
        <Card className="gap-0 py-4">
          <CardContent className="space-y-5 px-4">
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <Label className="text-[13px] font-medium">{t.long.gapsLabel}</Label>
                <span className="rounded-full bg-primary/12 px-2.5 py-0.5 text-[13px] font-bold tabular-nums text-primary dark:bg-primary/20">
                  {params.max_gap.toFixed(1)} {t.long.sec}
                </span>
              </div>
              <Slider
                value={[params.max_gap]}
                onValueChange={([v]) => set('max_gap', v)}
                min={0.5}
                max={10}
                step={0.5}
                aria-label={t.long.gapsLabel}
              />
            </div>
            <div className="space-y-2.5">
              <div className="flex items-center justify-between">
                <Label className="text-[13px] font-medium">{t.long.padLabel}</Label>
                <span className="rounded-full bg-primary/12 px-2.5 py-0.5 text-[13px] font-bold tabular-nums text-primary dark:bg-primary/20">
                  {params.pad.toFixed(1)} {t.long.sec}
                </span>
              </div>
              <Slider
                value={[params.pad]}
                onValueChange={([v]) => set('pad', v)}
                min={0.2}
                max={2}
                step={0.1}
                aria-label={t.long.padLabel}
              />
            </div>
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <span aria-hidden className="mt-0.5 shrink-0">✂️</span>
              {t.long.gapsNote}
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Транскрипция и главы */}
      <section className="space-y-2" aria-label={t.long.groupTranscript}>
        <GroupLabel>{t.long.groupTranscript}</GroupLabel>
        <Card className="gap-0 py-4">
          <CardContent className="space-y-3.5 px-4">
            <div className="space-y-1.5">
              <Label className="text-[12px] text-muted-foreground">{t.long.modelLabel}</Label>
              <Select value={params.whisper_model} onValueChange={(v) => set('whisper_model', v)}>
                <SelectTrigger aria-label={t.long.modelLabel} className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="small">{t.long.modelFast}</SelectItem>
                  <SelectItem value="large-v3-turbo">{t.long.modelBest}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl bg-black/[0.025] px-3.5 py-3 dark:bg-white/[0.04]">
              <span className="text-[13px] font-medium leading-snug">
                {t.long.chapters}
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {t.long.chaptersDesc}
                </span>
              </span>
              <Switch checked={params.chapters} onCheckedChange={(v) => { hapticTap(); set('chapters', v); }} aria-label={t.long.chapters} />
            </label>
            <div className="space-y-1.5">
              <Label className="text-[12px] text-muted-foreground">{t.long.metaTitle}</Label>
              <Input
                value={params.meta_title}
                onChange={(e) => set('meta_title', e.target.value)}
                placeholder={t.long.metaPlaceholder}
                maxLength={100}
                aria-label={t.long.metaTitle}
              />
            </div>
          </CardContent>
        </Card>
      </section>

      {/* CTA */}
      <div className="space-y-3 pt-1">
        <Button size="lg" className="h-[52px] w-full text-[15px]" onClick={submit} disabled={submitting}>
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : t.long.cta}
        </Button>
        <p className="text-center text-[12px] text-muted-foreground">
          {t.long.usedToday(user.dailyUsed, user.dailyLimit)}
        </p>
        <p className="text-center text-[11px] leading-relaxed text-muted-foreground/80">
          {t.long.progressNote}
        </p>
        <p className="flex items-start gap-1.5 px-1 text-[11px] leading-relaxed text-muted-foreground">
          <Captions className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          {t.long.subsNote}
        </p>
      </div>
    </div>
  );
}
