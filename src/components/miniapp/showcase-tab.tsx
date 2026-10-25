'use client';

// Вкладка «Витрина работ»: галерея готовых работ движка с предпросмотром.
// Улучшено на основе реверс-инжиниринга и прототипа Open Design:
// • Горизонтальная карусель «Лучшие работы недели» с бейджем «Выбор авторов»
// • Живой поиск и фильтр-чипы (Все / Shorts / 16:9 / Суды и КСУ / Инструкции)
// • Защита от схлопывания сетки (фиксированные aspect-ratio 9:16 и 16:9)
// • Обложки-фолбэки с фирменными градиентами и иконкой фильма (без битых картинок)
// • Умная модалка: автоопределение YouTube iframe vs нативный MP4 видеоплеер
// • Действия: «Смонтировать похожее», «На YouTube / Скопировать», «Поделиться в Telegram»

import { useMemo, useState } from 'react';
import {
  Clock,
  ExternalLink,
  Eye,
  Film,
  Play,
  Search,
  Share2,
  Sparkles,
  Star,
  Wand2,
  X,
  Zap,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { fmtDuration, fmtViews } from '@/lib/client-api';
import { hapticTap } from '@/lib/telegram-client';
import { useI18n } from '@/lib/i18n';
import type { ShowcaseItem } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

type FilterType = 'all' | 'shorts' | 'long' | 'courts' | 'howto';

// Фирменные градиенты Open Design для фолбэка обложек
const GRADIENTS = [
  'from-[#0c4a6e] via-[#075985] to-[#0369a1]', // cyan-sky
  'from-[#1e1b4b] via-[#312e81] to-[#4338ca]', // indigo
  'from-[#14532d] via-[#166534] to-[#15803d]', // emerald
  'from-[#701a75] via-[#86198f] to-[#a21caf]', // fuchsia
  'from-[#7c2d12] via-[#9a3412] to-[#c2410c]', // orange-amber
  'from-[#1e293b] via-[#334155] to-[#475569]', // slate-graphite
];

// Дефолтные эталонные работы для витрины (реальные смонтированные видео из суда и КСУ)
const FALLBACK_ITEMS: ShowcaseItem[] = [
  {
    id: 'sc_ksu',
    kind: 'short',
    title: 'КСУ: Карантинні обмеження прав незаконні',
    subtitle: 'Сергій Велічко · Рішення КСУ від 29.09.2026',
    thumbUrl: '/showcase/ksu.jpg',
    videoUrl: 'https://youtu.be/OU03THwqGeM',
    durationSec: 98,
    views: 15900,
    featured: true,
    sort: 1,
  },
  {
    id: 'sc_makulatura',
    kind: 'short',
    title: 'Суддя відмовилась приймати макулатуру прокурора!',
    subtitle: 'Суд за ст. 114-1 КК України · Запоріжжя',
    thumbUrl: '/showcase/makulatura.jpg',
    videoUrl: '/demo/makulatura.mp4',
    durationSec: 49,
    views: 12400,
    featured: true,
    sort: 2,
  },
  {
    id: 'sc_dates',
    kind: 'short',
    title: 'Акт вручили ДО того, як затвердили?! Ляп прокуратури',
    subtitle: 'Порушення ст. 290 КПК · Відкриття матеріалів',
    thumbUrl: '/showcase/dates.jpg',
    videoUrl: '/demo/dates.mp4',
    durationSec: 48,
    views: 9800,
    featured: true,
    sort: 3,
  },
  {
    id: 'sc_raport',
    kind: 'short',
    title: 'Відео до рапорту?! Адвокат розніс прокуратуру по ст. 104 КПК',
    subtitle: 'Правовий розбір судового засідання',
    thumbUrl: '/showcase/raport.jpg',
    videoUrl: '/demo/raport.mp4',
    durationSec: 54,
    views: 8700,
    featured: false,
    sort: 4,
  },
  {
    id: 'sc_ekspertyzy',
    kind: 'short',
    title: 'Експертизи після закриття слідства?! Прокурор виправдовується!',
    subtitle: 'Порушення строків досудового розслідування',
    thumbUrl: '/showcase/ekspertyzy.jpg',
    videoUrl: '/demo/ekspertyzy.mp4',
    durationSec: 46,
    views: 11200,
    featured: false,
    sort: 5,
  },
  {
    id: 'sc_velychko_court',
    kind: 'short',
    title: 'Сергій Велічко в суді: Строки слідства закінчилися!',
    subtitle: 'Виступ у суді за ст. 114-1 КК України',
    thumbUrl: '/showcase/velychko_court.jpg',
    videoUrl: '/demo/velychko_court.mp4',
    durationSec: 49,
    views: 16800,
    featured: true,
    sort: 6,
  },
  {
    id: 'sc_domdara',
    kind: 'short',
    title: 'Суд ухвалив: без даних у реєстрі представник НЕ ДІЙСНИЙ!',
    subtitle: 'Прецедент Верховного Суду України · domdara.org',
    thumbUrl: '/showcase/domdara_news.jpg',
    videoUrl: '/demo/domdara_court.mp4',
    durationSec: 42,
    views: 7600,
    featured: false,
    sort: 7,
  },
  {
    id: 'sc_long_court',
    kind: 'long',
    title: 'Повне засідання суду за ст. 114-1: клопотання та строки',
    subtitle: 'Повний запис судового засідання 16:9 із главами та таймкодами',
    thumbUrl: '/showcase/court_long.jpg',
    videoUrl: 'https://youtu.be/OU03THwqGeM',
    durationSec: 1104,
    views: 22700,
    featured: true,
    sort: 8,
  },
];

function extractYouTubeId(url: string): string | null {
  const match = url.match(/(?:youtu\.be\/|youtube\.com\/(?:embed\/|v\/|watch\?v=|shorts\/))([\w-]{11})/);
  return match ? match[1] : null;
}

export function ShowcaseTab({
  items,
  reload,
  onNavigate,
}: {
  items: ShowcaseItem[];
  reload: () => void;
  onNavigate?: (tab: 'shorts' | 'long' | 'hooks') => void;
}) {
  const { t } = useI18n();

  // Состояние поиска и фильтра
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [open, setOpen] = useState<ShowcaseItem | null>(null);
  const [orderModal, setOrderModal] = useState<ShowcaseItem | null>(null);
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({});

  // Объединяем полученные из API записи с эталонными демонстрационными
  const allItems = useMemo(() => {
    if (!items || items.length === 0) return FALLBACK_ITEMS;
    const existingIds = new Set(items.map((i) => i.id));
    const combined = [...items];
    FALLBACK_ITEMS.forEach((f) => {
      if (!existingIds.has(f.id)) combined.push(f);
    });
    return combined;
  }, [items]);

  // Фильтрация и поиск
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allItems.filter((item) => {
      const matchSearch =
        !q ||
        item.title.toLowerCase().includes(q) ||
        (item.subtitle && item.subtitle.toLowerCase().includes(q));

      if (!matchSearch) return false;

      if (filter === 'all') return true;
      if (filter === 'shorts') return item.kind === 'short';
      if (filter === 'long') return item.kind === 'long';
      if (filter === 'courts') {
        const text = (item.title + ' ' + (item.subtitle || '')).toLowerCase();
        return text.includes('суд') || text.includes('ксу') || text.includes('кпк');
      }
      if (filter === 'howto') {
        const text = (item.title + ' ' + (item.subtitle || '')).toLowerCase();
        return text.includes('гайд') || text.includes('інструкц') || text.includes('як') || text.includes('запит');
      }
      return true;
    });
  }, [allItems, search, filter]);

  const featuredList = useMemo(() => {
    return allItems.filter((i) => i.featured).slice(0, 4);
  }, [allItems]);

  const shorts = useMemo(() => filtered.filter((i) => i.kind === 'short'), [filtered]);
  const longs = useMemo(() => filtered.filter((i) => i.kind === 'long'), [filtered]);

  const openItem = (item: ShowcaseItem) => {
    hapticTap();
    setOpen(item);
    // Счётчик просмотров через API
    fetch('/api/showcase', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id }),
    })
      .then(() => reload())
      .catch(() => undefined);
  };

  const handleCopyLink = (item: ShowcaseItem) => {
    hapticTap();
    const url = item.videoUrl || window.location.href;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        toast({ title: t.showcase.linkCopied, description: url });
      });
    } else {
      toast({ title: t.showcase.linkCopied, description: url });
    }
  };

  const handleShareTelegram = (item: ShowcaseItem) => {
    hapticTap();
    const url = item.videoUrl || window.location.href;
    const text = `${item.title} — Монтажная Кухня`;
    const shareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    if (window.Telegram?.WebApp?.openTelegramLink) {
      window.Telegram.WebApp.openTelegramLink(shareUrl);
    } else {
      window.open(shareUrl, '_blank', 'noopener');
    }
  };

  const handleMountSimilar = (item: ShowcaseItem) => {
    hapticTap();
    setOpen(null);
    if (onNavigate) {
      onNavigate(item.kind === 'short' ? 'shorts' : 'long');
      toast({
        title: t.showcase.orderDoneTitle,
        description: `Стиль: «${item.title.slice(0, 35)}…»`,
      });
    } else {
      setOrderModal(item);
    }
  };

  return (
    <div className="space-y-6 pb-8">
      {/* Шапка экрана витрины */}
      <div className="space-y-1 px-1">
        <h2 className="text-[26px] font-bold leading-tight tracking-tight">{t.showcase.title}</h2>
        <p className="text-[13px] text-muted-foreground">{t.showcase.subtitle}</p>
      </div>

      {/* Поле поиска с кнопкой очистки (Open Design паттерн) */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t.showcase.searchPlaceholder}
          className="h-11 rounded-2xl bg-black/[0.03] pl-10 pr-9 text-[13.5px] shadow-sm transition-all dark:bg-white/[0.05]"
        />
        {search && (
          <button
            type="button"
            onClick={() => {
              hapticTap();
              setSearch('');
            }}
            aria-label="Очистить поиск"
            className="absolute right-2.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-black/10 text-muted-foreground hover:bg-black/20 dark:bg-white/10"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Категории и фильтр-чипы (Open Design чип-лента) */}
      <div className="-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
        {(
          [
            ['all', t.showcase.filterAll],
            ['shorts', t.showcase.filterShorts],
            ['long', t.showcase.filterLong],
            ['courts', t.showcase.filterCourts],
            ['howto', t.showcase.filterHowto],
          ] as const
        ).map(([fKey, fLabel]) => {
          const isActive = filter === fKey;
          return (
            <button
              key={fKey}
              type="button"
              onClick={() => {
                hapticTap();
                setFilter(fKey);
              }}
              className={`tap-none shrink-0 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-all duration-150 active:scale-95 ${
                isActive
                  ? 'bg-primary text-white shadow-glow'
                  : 'border border-hairline bg-card text-muted-foreground hover:bg-black/[0.04] dark:hover:bg-white/[0.06]'
              }`}
            >
              {fLabel}
            </button>
          );
        })}
      </div>

      {/* Карусель «Лучшие работы недели» (Open Design Featured Rail) */}
      {!search && filter === 'all' && featuredList.length > 0 && (
        <section aria-label={t.showcase.featuredTitle} className="space-y-2.5">
          <div className="flex items-center justify-between px-1">
            <h3 className="text-[15px] font-bold tracking-tight">{t.showcase.featuredTitle}</h3>
            <span className="text-[11px] text-muted-foreground">{t.showcase.featuredSub}</span>
          </div>

          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-3 md:gap-4 md:px-0">
            {featuredList.map((item, idx) => {
              const hasErr = imgErrors[item.id];
              const grad = GRADIENTS[idx % GRADIENTS.length];
              return (
                <div
                  key={item.id}
                  className="group relative w-[82%] min-w-[260px] shrink-0 snap-start overflow-hidden rounded-3xl border border-hairline bg-card shadow-soft transition-all duration-300 hover:shadow-float md:w-auto md:min-w-0"
                >
                  {/* Медиа превью 16:9 */}
                  <div className="relative aspect-video w-full overflow-hidden bg-black/40">
                    {!hasErr && item.thumbUrl ? (
                      <div
                        className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
                        style={{ backgroundImage: `url('${item.thumbUrl}')` }}
                      >
                        <img
                          src={item.thumbUrl}
                          alt=""
                          className="hidden"
                          onError={() => setImgErrors((p) => ({ ...p, [item.id]: true }))}
                        />
                      </div>
                    ) : (
                      <div className={`absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br ${grad} p-4 text-center text-white`}>
                        <Film className="h-8 w-8 opacity-60" />
                        <span className="mt-1 line-clamp-1 text-[11px] font-semibold opacity-90">{item.title}</span>
                      </div>
                    )}

                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                    {/* Золотой бейдж «Выбор авторов» */}
                    <div className="absolute left-2.5 top-2.5">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#ff9f0a] px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-black shadow-sm">
                        <Zap className="h-2.5 w-2.5 fill-black" />
                        {t.showcase.featuredBadge}
                      </span>
                    </div>

                    {/* Кнопка Play по центру */}
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      aria-label="Смотреть ролик"
                      className="absolute inset-0 flex items-center justify-center opacity-90 transition-opacity duration-200 group-hover:opacity-100"
                    >
                      <span className="flex h-11 w-11 scale-95 items-center justify-center rounded-full bg-primary/90 text-white shadow-glow backdrop-blur-md transition-transform duration-200 group-hover:scale-110">
                        <Play className="ml-0.5 h-5 w-5 fill-white" />
                      </span>
                    </button>

                    {/* Метаданные поверх видео */}
                    <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center justify-between text-[10.5px] font-medium text-white/90">
                      <span className="flex items-center gap-1">
                        <Eye className="h-3 w-3" /> {fmtViews(item.views)}
                      </span>
                      <span className="rounded-md bg-black/60 px-1.5 py-0.5 font-mono text-[9.5px] tabular-nums backdrop-blur-sm">
                        {fmtDuration(item.durationSec)}
                      </span>
                    </div>
                  </div>

                  {/* Нижняя часть карточки с быстрым действием */}
                  <div className="space-y-2 p-3.5">
                    <h4 className="line-clamp-1 text-[13.5px] font-bold leading-tight">{item.title}</h4>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleMountSimilar(item)}
                      className="h-8 w-full gap-1 rounded-xl text-[11.5px] font-semibold"
                    >
                      <Wand2 className="h-3.5 w-3.5 text-primary" />
                      {t.showcase.quickMount}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Сетка Shorts 9:16 (Open Design фикс: 2 колонки, фиксированный aspect-ratio) */}
      {shorts.length > 0 && (
        <section aria-label={t.showcase.shortsSection} className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="flex items-center gap-2 text-[15px] font-bold tracking-tight">
              {t.showcase.shortsSection}
              <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary dark:bg-primary/20">
                {shorts.length}
              </span>
            </h3>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-4">
            {shorts.map((item, idx) => {
              const hasErr = imgErrors[item.id];
              const grad = GRADIENTS[idx % GRADIENTS.length];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openItem(item)}
                  className="tap-none group relative aspect-[9/16] w-full overflow-hidden rounded-3xl text-left shadow-soft ring-1 ring-black/10 outline-none transition-all duration-300 hover:shadow-float focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] dark:ring-white/15"
                >
                  {/* Обложка с защитой от сбоя */}
                  {!hasErr && item.thumbUrl ? (
                    <div
                      className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
                      style={{ backgroundImage: `url('${item.thumbUrl}')` }}
                    >
                      <img
                        src={item.thumbUrl}
                        alt=""
                        className="hidden"
                        onError={() => setImgErrors((p) => ({ ...p, [item.id]: true }))}
                      />
                    </div>
                  ) : (
                    <div className={`absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br ${grad} p-3 text-center text-white`}>
                      <Film className="h-8 w-8 opacity-70" />
                      <span className="mt-2 line-clamp-3 text-[10.5px] font-bold leading-tight opacity-90">{item.title}</span>
                    </div>
                  )}

                  {/* Градиентное затенение под тексты */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/30 to-black/30" />

                  {/* Бейдж формата */}
                  <div className="absolute left-2.5 top-2.5">
                    <span className="rounded-full bg-primary/90 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white backdrop-blur-sm">
                      Shorts
                    </span>
                  </div>

                  {item.featured && (
                    <div className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/40 backdrop-blur-md">
                      <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    </div>
                  )}

                  {/* Плавающая кнопка воспроизведения Play */}
                  <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 group-hover:opacity-100">
                    <span className="flex h-12 w-12 scale-90 items-center justify-center rounded-full bg-primary/90 shadow-glow backdrop-blur-md transition-transform duration-300 group-hover:scale-100">
                      <Play className="ml-0.5 h-5 w-5 fill-white text-white" />
                    </span>
                  </div>

                  {/* Нижняя плашка с названием и просмотрами */}
                  <div className="absolute inset-x-0 bottom-0 p-3">
                    <p className="line-clamp-2 text-[11.5px] font-bold leading-snug text-white">
                      {item.title}
                    </p>
                    <div className="mt-1.5 flex items-center justify-between text-[10px] text-white/80">
                      <span className="flex items-center gap-1">
                        <Eye className="h-2.5 w-2.5" />
                        {fmtViews(item.views)}
                      </span>
                      <span className="font-mono tabular-nums">{fmtDuration(item.durationSec)}</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Сетка Long 16:9 (Open Design фикс: полноширинные горизонтальные карточки) */}
      {longs.length > 0 && (
        <section aria-label={t.showcase.longSection} className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <h3 className="flex items-center gap-2 text-[15px] font-bold tracking-tight">
              {t.showcase.longSection}
              <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary dark:bg-primary/20">
                {longs.length}
              </span>
            </h3>
          </div>

          <div className="space-y-3.5">
            {longs.map((item, idx) => {
              const hasErr = imgErrors[item.id];
              const grad = GRADIENTS[idx % GRADIENTS.length];
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openItem(item)}
                  className="tap-none group relative w-full overflow-hidden rounded-3xl border border-hairline bg-card text-left shadow-soft outline-none transition-all duration-300 hover:shadow-float focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
                >
                  {/* Медиа блок 16:9 */}
                  <div className="relative aspect-video w-full overflow-hidden bg-black/40">
                    {!hasErr && item.thumbUrl ? (
                      <div
                        className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
                        style={{ backgroundImage: `url('${item.thumbUrl}')` }}
                      >
                        <img
                          src={item.thumbUrl}
                          alt=""
                          className="hidden"
                          onError={() => setImgErrors((p) => ({ ...p, [item.id]: true }))}
                        />
                      </div>
                    ) : (
                      <div className={`absolute inset-0 flex flex-col items-center justify-center bg-gradient-to-br ${grad} p-4 text-center text-white`}>
                        <Film className="h-10 w-10 opacity-70" />
                        <span className="mt-2 line-clamp-1 text-[13px] font-bold">{item.title}</span>
                      </div>
                    )}

                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                    <div className="absolute left-2.5 top-2.5">
                      <span className="rounded-full bg-black/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white backdrop-blur-md">
                        16:9 HD
                      </span>
                    </div>

                    {item.featured && (
                      <div className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-black/40 backdrop-blur-md">
                        <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                      </div>
                    )}

                    <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-all duration-300 group-hover:opacity-100">
                      <span className="flex h-14 w-14 scale-90 items-center justify-center rounded-full bg-primary/90 shadow-glow backdrop-blur-md transition-transform duration-300 group-hover:scale-100">
                        <Play className="ml-0.5 h-6 w-6 fill-white text-white" />
                      </span>
                    </div>

                    <div className="absolute bottom-2.5 right-2.5 rounded-md bg-black/60 px-2 py-0.5 font-mono text-[10px] text-white backdrop-blur-sm">
                      {fmtDuration(item.durationSec)}
                    </div>
                  </div>

                  {/* Описание под видео */}
                  <div className="p-4">
                    <p className="line-clamp-1 text-[14.5px] font-bold leading-tight">{item.title}</p>
                    {item.subtitle && (
                      <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">{item.subtitle}</p>
                    )}
                    <div className="mt-2.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Eye className="h-3 w-3" /> {fmtViews(item.views)}
                      </span>
                      <span>·</span>
                      <span className="flex items-center gap-1 font-mono">
                        <Clock className="h-3 w-3" /> {fmtDuration(item.durationSec)}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* Пустое состояние (Empty state) */}
      {filtered.length === 0 && (
        <div className="rounded-3xl border border-hairline bg-card/60 p-8 text-center shadow-soft">
          <Film className="mx-auto h-12 w-12 text-muted-foreground/50" />
          <h4 className="mt-3 text-[16px] font-bold">{t.showcase.emptyTitle}</h4>
          <p className="mt-1 text-[13px] text-muted-foreground">{t.showcase.emptyDesc}</p>
          <Button
            variant="outline"
            onClick={() => {
              hapticTap();
              setSearch('');
              setFilter('all');
            }}
            className="mt-4 rounded-xl"
          >
            {t.showcase.resetFilters}
          </Button>
        </div>
      )}

      {/* Кнопка прямого запуска Open Design прототипа */}
      <div className="pt-2 text-center">
        <a
          href="/prototype/index.html"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-4 py-2 text-[12px] font-semibold text-primary transition-all hover:bg-primary/20 active:scale-95"
        >
          <Sparkles className="h-3.5 w-3.5" />
          {t.showcase.openPrototype}
          <ExternalLink className="ml-0.5 h-3 w-3 opacity-70" />
        </a>
      </div>

      {/* Интерактивная модалка предпросмотра (авто YouTube iframe vs MP4) */}
      <Dialog open={Boolean(open)} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-[94vw] gap-3 rounded-3xl p-4 sm:max-w-md">
          {open && (
            <>
              <DialogHeader className="space-y-1 text-left">
                <DialogTitle className="pr-4 text-[16px] font-bold leading-snug tracking-tight">
                  {open.title}
                </DialogTitle>
                <DialogDescription className="text-[12px]">
                  {open.subtitle ?? t.showcase.dialogFallback}
                </DialogDescription>
              </DialogHeader>

              {/* Автоопределение источника: YouTube или MP4 */}
              {open.videoUrl && extractYouTubeId(open.videoUrl) ? (
                <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-sm ring-1 ring-black/10">
                  <iframe
                    src={`https://www.youtube.com/embed/${extractYouTubeId(open.videoUrl)}?autoplay=1&mute=1&rel=0&playsinline=1`}
                    title={open.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="absolute inset-0 h-full w-full border-0"
                  />
                </div>
              ) : open.videoUrl ? (
                <video
                  key={open.id}
                  src={open.videoUrl}
                  controls
                  playsInline
                  autoPlay
                  preload="metadata"
                  className={`w-full rounded-2xl bg-black ring-1 ring-black/10 dark:ring-white/10 ${
                    open.kind === 'short' ? 'mx-auto aspect-[9/16] max-h-[52vh]' : 'aspect-video'
                  }`}
                />
              ) : (
                <div
                  className="aspect-video w-full rounded-2xl bg-cover bg-center ring-1 ring-black/10"
                  style={{ backgroundImage: `url('${open.thumbUrl}')` }}
                />
              )}

              {/* Метрики ролика */}
              <div className="flex flex-wrap items-center gap-3 pt-1 text-[11.5px] text-muted-foreground">
                <span className="flex items-center gap-1 font-semibold text-foreground">
                  <Eye className="h-3 w-3 text-primary" /> {fmtViews(open.views)}
                </span>
                <span>·</span>
                <span className="font-mono tabular-nums">{fmtDuration(open.durationSec)}</span>
                <span>·</span>
                <span className="rounded-md bg-black/[0.05] px-2 py-0.5 text-[10px] font-bold uppercase dark:bg-white/[0.08]">
                  {open.kind === 'short' ? 'Shorts 9:16' : '16:9 HD'}
                </span>
              </div>

              {/* Действия модалки Open Design */}
              <div className="space-y-2 pt-2">
                <Button
                  size="lg"
                  className="h-11 w-full gap-2 rounded-2xl text-[14px] font-bold shadow-glow"
                  onClick={() => handleMountSimilar(open)}
                >
                  <Wand2 className="h-4 w-4" />
                  {t.showcase.mountSimilar}
                </Button>

                <div className="grid grid-cols-2 gap-2">
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (open.videoUrl && extractYouTubeId(open.videoUrl)) {
                        window.open(open.videoUrl, '_blank', 'noopener');
                      } else {
                        handleCopyLink(open);
                      }
                    }}
                    className="h-10 gap-1.5 rounded-xl text-[12px]"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    {open.videoUrl && extractYouTubeId(open.videoUrl)
                      ? t.showcase.onYoutube
                      : t.showcase.copyLink}
                  </Button>

                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleShareTelegram(open)}
                    className="h-10 gap-1.5 rounded-xl text-[12px]"
                  >
                    <Share2 className="h-3.5 w-3.5 text-primary" />
                    {t.showcase.share}
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
