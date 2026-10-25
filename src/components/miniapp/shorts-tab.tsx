'use client';

// Вкладка «Монтаж Shorts»: пресеты «В 1 клик», загрузка, титулы, субтитры, кадр обложки.
// Дизайн: inset grouped секции iOS + System Blue CTA + человеческая микрокопия «для чайников».

import { useState } from 'react';
import { Loader2, Scissors, Sparkles, Type } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api, fmtDuration } from '@/lib/client-api';
import { hapticSuccess, hapticTap } from '@/lib/telegram-client';
import { useI18n } from '@/lib/i18n';
import type { ShortsParams, User } from '@/lib/types';
import { DEFAULT_SHORTS } from '@/lib/types';
import { SourcePicker, type SourceMode } from '@/components/miniapp/source-picker';
import { OnboardingSteps } from '@/components/miniapp/onboarding-steps';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

const LANGS = [
  { value: 'uk', key: 'langUk' },
  { value: 'ru', key: 'langRu' },
  { value: 'en', key: 'langEn' },
] as const;

const SUBS = [
  { value: 'ru', key: 'subRu' },
  { value: 'uk', key: 'subUk' },
  { value: 'en', key: 'langEn' },
  { value: 'off', key: 'subOff' },
] as const;

// Пример строки субтитров для превью — по выбранному языку
const SUB_SAMPLE: Record<string, string> = {
  ru: 'Сегодня рассматривается дело о выделении земли',
  uk: 'Сьогодні розглядається справа про виділення землі',
  en: 'Today the council hears the land case',
};

type PresetKey = 'viral' | 'podcast' | 'law';

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
  const { t } = useI18n();
  const [mode, setMode] = useState<SourceMode>('upload');
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [params, setParams] = useState<ShortsParams>({ ...DEFAULT_SHORTS });
  const [clipLength, setClipLength] = useState(60); // демо-длительность для таймкодов обложки
  const [submitting, setSubmitting] = useState(false);

  const set = <K extends keyof ShortsParams>(k: K, v: ShortsParams[K]) =>
    setParams((p) => ({ ...p, [k]: v }));

  const coverTimecode = fmtDuration(Math.max(1, Math.round((clipLength * params.cover_frame) / 100)));

  // ── Быстрые пресеты стиля «В 1 клик»: заполняют все поля автоматически ──
  const applyPreset = (key: PresetKey) => {
    hapticTap();
    const preset: ShortsParams =
      key === 'viral'
        ? {
            ...params,
            title_line1: t.shorts.presetViralTitle,
            title_line2: '',
            overlay_label: t.shorts.presetViralOverlay,
            pill_text: t.shorts.presetViralPill,
            speech_lang: 'uk',
            subtitle_lang: 'ru',
            bilingual: true,
            cover_frame: 40,
          }
        : key === 'podcast'
          ? {
              ...params,
              title_line1: t.shorts.presetPodcastTitle,
              title_line2: '',
              overlay_label: t.shorts.presetPodcastOverlay,
              pill_text: t.shorts.presetPodcastPill,
              speech_lang: 'uk',
              subtitle_lang: 'off',
              bilingual: false,
              cover_frame: 20,
            }
          : {
              ...params,
              title_line1: t.shorts.presetLawTitle,
              title_line2: '',
              overlay_label: t.shorts.presetLawOverlay,
              pill_text: t.shorts.presetLawPill,
              speech_lang: 'uk',
              subtitle_lang: 'ru',
              bilingual: true,
              cover_frame: 35,
            };
    if (key === 'viral' || key === 'law') setClipLength(45);
    else setClipLength(60);
    setParams(preset);
    toast({ title: `✨ ${t.shorts.presetAppliedTitle}`, description: t.shorts.presetAppliedDesc });
  };

  const submit = async () => {
    hapticTap();
    if (mode === 'upload' && !file) {
      toast({ title: t.shorts.needFile, variant: 'destructive' });
      return;
    }
    if (mode !== 'upload' && !url.trim()) {
      toast({ title: t.shorts.needUrl, variant: 'destructive' });
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
        title: t.shorts.queuedTitle,
        description: t.shorts.queuedDesc,
      });
      setFile(null);
      setUrl('');
      setParams({ ...DEFAULT_SHORTS });
      onCreated();
    } catch (e) {
      toast({
        title: t.shorts.failQueue,
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    } finally {
      setSubmitting(false);
    }
  };

  const langLabel = (key: (typeof LANGS)[number]['key']) => t.shorts[key];
  const subLabel = (key: (typeof SUBS)[number]['key']) => t.shorts[key];

  // ── Улучшения монтажа (P1–P3): вырезка пауз · SFX · музыка · дубляж ──
  const ENHANCEMENTS = [
    { key: 'remove_silence', label: t.shorts.optSilence, desc: t.shorts.optSilenceDesc },
    { key: 'sfx', label: t.shorts.optSfx, desc: t.shorts.optSfxDesc },
    { key: 'music', label: t.shorts.optMusic, desc: t.shorts.optMusicDesc },
    { key: 'dub', label: t.shorts.optDub, desc: t.shorts.optDubDesc },
  ] as const;

  return (
    <div className="md:grid md:grid-cols-[minmax(0,1fr)_360px] md:items-start md:gap-7 lg:grid-cols-[minmax(0,1fr)_420px]">
      <div className="space-y-6 pb-6">
      {/* Закреплённый онбординг «3 шага» */}
      <OnboardingSteps />

      {/* Заголовок экрана */}
      <div className="space-y-1 px-1">
        <h2 className="text-[26px] font-bold leading-tight tracking-tight">{t.shorts.title}</h2>
        <p className="text-[13px] text-muted-foreground">{t.shorts.subtitle}</p>
      </div>

      {/* Пресеты стиля «В 1 клик» */}
      <section className="space-y-2" aria-label={t.shorts.presetsLabel}>
        <GroupLabel>{t.shorts.presetsLabel}</GroupLabel>
        <div className="-mx-4 flex snap-x gap-2.5 overflow-x-auto px-4 pb-1 md:mx-0 md:grid md:grid-cols-3 md:px-0">
          {(
            [
              ['viral', t.shorts.presetViral, t.shorts.presetViralHint],
              ['podcast', t.shorts.presetPodcast, t.shorts.presetPodcastHint],
              ['law', t.shorts.presetLaw, t.shorts.presetLawHint],
            ] as const
          ).map(([key, name, hint]) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key)}
              className="tap-none w-[62%] min-w-[150px] shrink-0 snap-start rounded-2xl border border-hairline bg-card px-3.5 py-3 text-left shadow-soft transition-all duration-200 hover:border-primary/45 hover:shadow-float active:scale-[0.97] md:w-auto md:min-w-0"
            >
              <span className="block truncate text-[13.5px] font-semibold">{name}</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{hint}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Что вы получаете — человеческими словами, без технических терминов */}
      <section aria-label="Возможности монтажа">
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {(
            [
              [t.shorts.featSound, t.shorts.featSoundDesc],
              [t.shorts.featReach, t.shorts.featReachDesc],
              [t.shorts.featCover, t.shorts.featCoverDesc],
              [t.shorts.featCut, t.shorts.featCutDesc],
            ] as const
          ).map(([name, desc]) => (
            <div
              key={name}
              className="rounded-2xl border border-hairline bg-card/70 px-3.5 py-3 shadow-soft"
            >
              <p className="text-[12.5px] font-semibold leading-snug">{name}</p>
              <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Источник */}
      <section className="space-y-2" aria-label={t.shorts.groupSource}>
        <GroupLabel>{t.shorts.groupSource}</GroupLabel>
        <Card className="gap-0 py-4">
          <CardContent className="px-4">
            <SourcePicker mode={mode} onModeChange={setMode} file={file} onFileChange={setFile} url={url} onUrlChange={setUrl} />
          </CardContent>
        </Card>
      </section>

      {/* Титры и плашка */}
      <section className="space-y-2" aria-label={t.shorts.groupTitles}>
        <GroupLabel>{t.shorts.groupTitles}</GroupLabel>
        <Card className="gap-0 py-4">
          <CardContent className="space-y-3.5 px-4">
            <div className="grid grid-cols-2 gap-2.5">
              <Input
                value={params.title_line1}
                onChange={(e) => set('title_line1', e.target.value)}
                placeholder={t.shorts.titlePlaceholder1}
                maxLength={40}
                aria-label={t.shorts.titlePlaceholder1}
              />
              <Input
                value={params.title_line2}
                onChange={(e) => set('title_line2', e.target.value)}
                placeholder={t.shorts.titlePlaceholder2}
                maxLength={40}
                aria-label={t.shorts.titlePlaceholder2}
              />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <Input
                value={params.overlay_label}
                onChange={(e) => set('overlay_label', e.target.value)}
                placeholder={t.shorts.overlayPlaceholder}
                maxLength={30}
                aria-label={t.shorts.overlayPlaceholder}
              />
              <Input
                value={params.pill_text}
                onChange={(e) => set('pill_text', e.target.value)}
                placeholder={t.shorts.pillPlaceholder}
                maxLength={30}
                aria-label={t.shorts.pillPlaceholder}
              />
            </div>
            <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <Type className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              {t.shorts.titlesNote}
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Субтитры */}
      <section className="space-y-2" aria-label={t.shorts.groupSubs}>
        <GroupLabel>{t.shorts.groupSubs}</GroupLabel>
        <Card className="gap-0 py-4">
          <CardContent className="space-y-3.5 px-4">
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1.5">
                <Label className="text-[12px] text-muted-foreground">{t.shorts.speechLang}</Label>
                <Select value={params.speech_lang} onValueChange={(v) => set('speech_lang', v)}>
                  <SelectTrigger aria-label={t.shorts.speechLang} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {LANGS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>{langLabel(l.key)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[12px] text-muted-foreground">{t.shorts.subLang}</Label>
                <Select value={params.subtitle_lang} onValueChange={(v) => set('subtitle_lang', v)}>
                  <SelectTrigger aria-label={t.shorts.subLang} className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SUBS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>{subLabel(l.key)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <label className="flex cursor-pointer items-center justify-between gap-3 rounded-2xl bg-black/[0.025] px-3.5 py-3 dark:bg-white/[0.04]">
              <span className="text-[13px] font-medium leading-snug">
                {t.shorts.bilingual}
                <span className="block text-[11px] font-normal text-muted-foreground">
                  {t.shorts.bilingualDesc}
                </span>
              </span>
              <Switch
                checked={params.bilingual}
                onCheckedChange={(v) => {
                  hapticTap();
                  set('bilingual', v);
                }}
                aria-label={t.shorts.bilingual}
              />
            </label>
          </CardContent>
        </Card>
      </section>

      {/* Улучшения монтажа — тумблеры в стиле iOS Settings */}
      <section className="space-y-2" aria-label={t.shorts.groupEnhance}>
        <GroupLabel>{t.shorts.groupEnhance}</GroupLabel>
        <Card className="gap-0 py-2">
          <CardContent className="space-y-0 px-3">
            {ENHANCEMENTS.map(({ key, label, desc }) => (
              <label
                key={key}
                className="flex cursor-pointer items-center justify-between gap-3 border-b border-hairline px-1.5 py-3 last:border-b-0"
              >
                <span className="min-w-0 text-[13px] font-medium leading-snug">
                  {label}
                  <span className="mt-0.5 block text-[11px] font-normal leading-snug text-muted-foreground">
                    {desc}
                  </span>
                </span>
                <Switch
                  checked={params[key]}
                  onCheckedChange={(v) => {
                    hapticTap();
                    set(key, v);
                  }}
                  aria-label={label}
                />
              </label>
            ))}
            <p className="flex items-start gap-1.5 px-1.5 pt-2 text-[10.5px] leading-relaxed text-muted-foreground/80">
              <Scissors className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
              {t.shorts.progressNote}
            </p>
          </CardContent>
        </Card>
      </section>

      {/* Обложка */}
      <section className="space-y-2" aria-label={t.shorts.groupCover}>
        <GroupLabel>{t.shorts.groupCover}</GroupLabel>
        <Card className="gap-0 py-4">
          <CardContent className="space-y-4 px-4">
            <CoverPreview params={params} size="sm" className="mx-auto w-[46%] md:hidden" />

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label className="text-[12px] text-muted-foreground">{t.shorts.coverPosition}</Label>
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
                aria-label={t.shorts.coverPosition}
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
                aria-label={t.shorts.clipLengthLabel}
              />
              <span className="text-[11px] leading-snug text-muted-foreground">
                {t.shorts.clipLengthHint}
              </span>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* CTA — мобильная версия (на десктопе кнопка в панели предпросмотра) */}
      <div className="space-y-3 pt-1 md:hidden">
        <Button size="lg" className="h-[52px] w-full text-[15px]" onClick={submit} disabled={submitting}>
          {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : t.shorts.cta}
        </Button>
        <p className="text-center text-[12px] text-muted-foreground">
          {t.shorts.usedToday(user.dailyUsed, user.dailyLimit)}
        </p>
        <p className="text-center text-[11px] leading-relaxed text-muted-foreground/80">
          {t.shorts.progressNote}
        </p>
      </div>

      </div>

      {/* Desktop-панель предпросмотра: большой кадр 1080×1920 + кнопка запуска */}
      <aside className="hidden md:sticky md:top-24 md:block" aria-label={t.shorts.previewLabel}>
        <div className="space-y-4 rounded-3xl border border-hairline bg-card/70 p-5 shadow-soft">
          <div className="flex items-center justify-between px-1">
            <p className="text-[12px] font-semibold uppercase tracking-[0.07em] text-muted-foreground">
              {t.shorts.previewLabel}
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
            {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : t.shorts.cta}
          </Button>

          <p className="text-center text-[12px] text-muted-foreground">
            {t.shorts.usedToday(user.dailyUsed, user.dailyLimit)}
          </p>

          <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
            <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            {t.shorts.progressNote}
          </p>
        </div>
      </aside>
    </div>
  );
}
