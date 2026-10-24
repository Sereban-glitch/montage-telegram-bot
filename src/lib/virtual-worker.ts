import { db } from '@/lib/db';
import { parseParams } from '@/lib/seed';

// ================================================================
// Виртуальный воркер FIFO-очереди (демо-контур для песочницы).
// В продакшене его роль выполняет services/worker (Python): тот же
// жизненный цикл queued → processing → completed, тот же FIFO,
// тот же единственный слот рендера (защита 12 ГБ ОЗУ).
// ================================================================

type StageSpec = { key: string; label: string; from: number; to: number };

const SHORT_STAGES: StageSpec[] = [
  { key: 'download', label: 'Загрузка видео', from: 0.0, to: 0.08 },
  { key: 'audio', label: 'Извлечение аудио (ffmpeg)', from: 0.08, to: 0.14 },
  { key: 'transcribe', label: 'Транскрипция Whisper', from: 0.14, to: 0.34 },
  { key: 'cut', label: 'Подбор динамичной нарезки', from: 0.34, to: 0.42 },
  { key: 'render', label: 'Рендер сегментов', from: 0.42, to: 0.85 },
  { key: 'cover', label: 'Вертикальная обложка 1080×1920', from: 0.85, to: 0.93 },
  { key: 'upload', label: 'Упаковка и нормализация EBU R128', from: 0.93, to: 0.99 },
];

const LONG_STAGES: StageSpec[] = [
  { key: 'download', label: 'Загрузка видео', from: 0.0, to: 0.06 },
  { key: 'audio', label: 'Извлечение аудио 16 кГц (ffmpeg)', from: 0.06, to: 0.12 },
  { key: 'transcribe', label: 'Транскрипция Whisper large-v3-turbo', from: 0.12, to: 0.38 },
  { key: 'audit', label: 'Аудит пауз (audit_gaps)', from: 0.38, to: 0.48 },
  { key: 'render', label: 'Последовательный рендер сегментов', from: 0.48, to: 0.9 },
  { key: 'concat', label: 'Склейка без перекодирования', from: 0.9, to: 0.94 },
  { key: 'cover', label: 'Обложка 1280×720 + главы', from: 0.94, to: 0.98 },
];

// Фича №1: анализ хуков (только аудио — быстро)
const HOOK_ANALYSIS_STAGES: StageSpec[] = [
  { key: 'fetch', label: 'Загрузка аудиодорожки (yt-dlp, только звук)', from: 0.0, to: 0.18 },
  { key: 'transcribe', label: 'Транскрипция Whisper с таймкодами', from: 0.18, to: 0.58 },
  { key: 'analyze', label: 'AI Hook Scoring: хук · эмоции · удержание', from: 0.58, to: 0.9 },
  { key: 'menu', label: 'Формирование меню фрагментов', from: 0.9, to: 0.99 },
];

// Фича №1: рендер выбранного фрагмента (фирменный Short движка)
const HOOK_RENDER_STAGES: StageSpec[] = [
  { key: 'fetch', label: 'Скачивание фрагмента (--download-sections)', from: 0.0, to: 0.22 },
  { key: 'cut', label: 'Субтитры фрагмента и кадр обложки', from: 0.22, to: 0.32 },
  { key: 'render', label: 'Фирменный рендер 1080×1920 (движок)', from: 0.32, to: 0.84 },
  { key: 'cover', label: 'Обложка и YouTube-пакет', from: 0.84, to: 0.94 },
];

// Фича №2: domdara → News Short
const NEWS_STAGES: StageSpec[] = [
  { key: 'script', label: 'Сценарий 45 c (хук → фабула → вывод)', from: 0.0, to: 0.12 },
  { key: 'tts', label: 'Озвучка edge-tts (украинский голос)', from: 0.12, to: 0.38 },
  { key: 'loudnorm', label: 'Нормализация EBU R128 (-14 LUFS)', from: 0.38, to: 0.48 },
  { key: 'subs', label: 'Караоке-субтитры (активное слово золотом)', from: 0.48, to: 0.58 },
  { key: 'background', label: 'Фирменный фон 1080×1920 (§ · рамка · титул)', from: 0.58, to: 0.66 },
  { key: 'render', label: 'Рендер H.264 вертикального ролика', from: 0.66, to: 0.9 },
  { key: 'moderation', label: 'Ожидает модерации владельца', from: 0.9, to: 0.99 },
];

const TOTAL_MS = {
  short: 46_000, // демо-скорость конвейера
  long: 74_000,
  hook_analysis: 34_000,
  hook_render: 40_000,
  news_shorts: 52_000,
} as Record<string, number>;

const WORKER_RAM_IDLE_MB = 2100;
const TOTAL_RAM_MB = 12288;

const g = globalThis as unknown as { __mkWorkerTimer?: NodeJS.Timeout };

function hashNum(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function stagesFor(type: string): StageSpec[] {
  switch (type) {
    case 'long': return LONG_STAGES;
    case 'hook_analysis': return HOOK_ANALYSIS_STAGES;
    case 'hook_render': return HOOK_RENDER_STAGES;
    case 'news_shorts': return NEWS_STAGES;
    default: return SHORT_STAGES;
  }
}

function stageAt(type: string, frac: number): StageSpec {
  const stages = stagesFor(type);
  for (const st of stages) if (frac >= st.from && frac < st.to) return st;
  return stages[stages.length - 1];
}

// Правдоподобная имитация потребления ОЗУ по этапам конвейера
function ramForStage(type: string, frac: number): number {
  const st = stageAt(type, frac);
  if (type === 'hook_analysis') {
    // анализ легче: аудио + Whisper small
    if (st.key === 'transcribe') return 3200 + (hashNum(st.key) % 200);
    if (st.key === 'analyze') return 1900;
    return 1500;
  }
  if (type === 'news_shorts') {
    // TTS-конвейер без видео-декода: лёгкий (фон priority=1)
    if (st.key === 'render') return 2300;
    return 1400;
  }
  if (st.key === 'transcribe') return 4300 + (hashNum(st.key) % 300);
  if (st.key === 'render') {
    const t = (frac - st.from) / (st.to - st.from); // 0..1 внутри рендера
    return Math.round(3400 + t * 4200); // 3.4 → 7.6 ГБ (сегменты)
  }
  if (st.key === 'concat' || st.key === 'cover') return 2900;
  if (st.key === 'audit') return 2600;
  return 2400;
}

function segmentsFor(type: string, jobId: string): number {
  const base = type === 'long' ? 7 : 5;
  return base + (hashNum(jobId) % 3); // 7..9 long / 5..7 short
}

async function logEvent(jobId: string | null, message: string, level = 'info') {
  await db.event.create({ data: { jobId, level, message } });
}

async function tick() {
  try {
    const workerEnabled = (await db.setting.findUnique({ where: { key: 'worker_enabled' } }))?.value !== 'false';

    await processApprovals();

    const processing = await db.job.findFirst({
      where: { status: 'processing' },
      orderBy: { startedAt: 'asc' },
    });

    if (processing) {
      await advance(processing);
    } else if (workerEnabled) {
      // Zero-Conflict Queue: priority=10 (друзья) ВСЕГДА вырывают слот рендера
      // у фоновых новостей (priority=1), внутри приоритета — FIFO
      const next = await db.job.findFirst({
        where: { status: 'queued' },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
      });
      if (next) await start(next.id);
    }

    // Пересчёт позиций в очереди в порядке ВЫПОЛНЕНИЯ (priority DESC → FIFO)
    const queued = await db.job.findMany({
      where: { status: 'queued' },
      orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }],
    });
    for (let i = 0; i < queued.length; i++) {
      if (queued[i].queuePosition !== i + 1) {
        await db.job.update({ where: { id: queued[i].id }, data: { queuePosition: i + 1 } });
      }
    }
  } catch (e) {
    console.error('[virtual-worker] tick error', e);
  }
}

// ── Human-in-the-Loop: одобрение → YouTube private (демо-имитация) ──
async function processApprovals() {
  const approved = await db.job.findMany({
    where: { type: 'news_shorts', status: 'completed', approvalStatus: 'approved' },
    orderBy: { completedAt: 'asc' },
  });
  for (const job of approved) {
    const started = job.completedAt?.getTime() ?? Date.now();
    if (Date.now() - started < 6000) continue; // имитация resumable-выгрузки ~6 с
    const videoId = `demo_${job.id.slice(0, 8)}`;
    const params = parseParams(job.params);
    params.youtube_video_id = videoId;
    await db.job.update({
      where: { id: job.id },
      data: {
        approvalStatus: 'uploaded',
        stageLabel: `Выгружено на YouTube (private): youtu.be/${videoId}`,
        params: JSON.stringify(params),
      },
    });
    await db.newsArticle.updateMany({ where: { jobId: job.id }, data: { state: 'approved' } });
    await logEvent(job.id, `YouTube: выгружено private → https://youtu.be/${videoId} (доступ откроет владелец в студии)`);
  }
}

async function start(jobId: string) {
  const job = await db.job.update({
    where: { id: jobId },
    data: { status: 'processing', startedAt: new Date(), stageKey: 'download', stageLabel: 'Загрузка видео', progress: 0, queuePosition: 0, ramMb: 2400 },
  });
  const kindLabel = {
    short: 'Short', long: 'Long', hook_analysis: 'Hook Finder',
    hook_render: 'Hook Short', news_shorts: 'News Short',
  }[job.type] ?? job.type;
  await logEvent(jobId, `Воркер: задача ${kindLabel} «${job.sourceName ?? job.sourceUrl ?? jobId}» принята в слот рендера (priority=${job.priority})`);
  await logEvent(jobId, 'Source: подготовка рабочего каталога /data/media/' + jobId);
}

async function advance(job: { id: string; type: string; startedAt: Date | null; progress: number; stageKey: string | null; params: string; sourceName: string | null; sourceUrl: string | null }) {
  const total = TOTAL_MS[job.type as 'short' | 'long'] ?? TOTAL_MS.short;
  const started = job.startedAt?.getTime() ?? Date.now();
  const frac = Math.min(1, (Date.now() - started) / total);
  const st = stageAt(job.type, frac);
  const params = parseParams(job.params);
  const segments = segmentsFor(job.type, job.id);

  let stageLabel = st.label;
  let progress = Math.round(frac * 100);

  // Сегментный рендер: честно показываем i/N — как render_segments.py в движке
  if (st.key === 'render') {
    const t = (frac - st.from) / (st.to - st.from);
    const seg = Math.min(segments, Math.max(1, Math.ceil(t * segments)));
    stageLabel = `Рендер сегментов ${seg}/${segments}`;
  }

  // Финализация
  if (frac >= 1) {
    if (job.type === 'hook_analysis') {
      // Демо-кандидаты Hook Scorer: детерминированы по jobId (правдоподобные судебные хуки)
      const cands = mockCandidates(job.id);
      params.candidates = cands;
      params.analysis_done = true;
      await db.job.update({
        where: { id: job.id },
        data: {
          status: 'completed',
          progress: 100,
          stageKey: 'done',
          stageLabel: 'Готово — кандидаты отобраны',
          ramMb: WORKER_RAM_IDLE_MB,
          notified: true,
          params: JSON.stringify(params),
          completedAt: new Date(),
        },
      });
      await logEvent(job.id, `Hook Scorer: отобрано ${cands.length} кандидатов (scores: ${cands.map((c: { score: number }) => c.score).join(', ')})`);
      await logEvent(job.id, 'Бот: меню фрагментов с Virality Score отправлено в чат');
      await logEvent(null, `Воркер: слот освобождён, RAM ${WORKER_RAM_IDLE_MB}/${TOTAL_RAM_MB} МБ`);
      return;
    }

    const thumb = job.type === 'long' ? '/showcase/long-session.png' : '/showcase/short-court.png';
    const resultUrl = job.type === 'news_shorts' ? '/demo/news_short.mp4' : '/demo/final_short.mp4';
    const ytMeta = mockYoutubeMeta(job.type, job.sourceName ?? '', params);
    params.youtube_meta = ytMeta;

    if (job.type === 'news_shorts') {
      params.hook = params.hook ?? `Судебный прецедент, который стоит вашего внимания. ${job.sourceName ?? ''}`;
      params.conclusion = params.conclusion ?? 'Запомните главное: это решение — прецедент. Подписывайтесь — разбираем судебные решения простыми словами.';
      params.duration_sec = 45;
      params.voice = 'uk-UA-OstapNeural';
      await db.newsArticle.updateMany({ where: { jobId: job.id }, data: { state: 'rendered' } });
    }

    await db.job.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        progress: 100,
        stageKey: 'done',
        stageLabel: job.type === 'news_shorts' ? 'Готово — ожидает одобрения' : 'Готово — final.mp4',
        resultUrl,
        thumbUrl: thumb,
        ramMb: WORKER_RAM_IDLE_MB,
        notified: true,
        ...(job.type === 'news_shorts' ? { approvalStatus: 'pending' } : {}),
        params: JSON.stringify(params),
        completedAt: new Date(),
      },
    });
    await logEvent(job.id, job.type === 'news_shorts'
      ? 'News Short готов: караоке-субтитры, EBU R128 -14 LUFS — ожидает модерации владельца'
      : 'Движок: loudnorm I=-14 TP=-1.5 LRA=11 применён, final.mp4 собран (YouTube-пакет приложен)');
    await logEvent(job.id, 'Бот: файл final.mp4 отправлен пользователю в чат вместе с пакетом метаданных');
    await logEvent(null, `Воркер: слот освобождён, RAM ${WORKER_RAM_IDLE_MB}/${TOTAL_RAM_MB} МБ`);
    return;
  }

  const changedStage = job.stageKey !== st.key;
  await db.job.update({
    where: { id: job.id },
    data: { stageKey: st.key, stageLabel, progress, ramMb: ramForStage(job.type, frac) },
  });

  if (changedStage) {
    await logEvent(job.id, `Этап: ${st.label}`);
    if (st.key === 'transcribe') {
      await logEvent(job.id, `Whisper: модель ${params.whisper_model ?? (job.type === 'long' ? 'large-v3-turbo' : 'small')}, compute int8`);
    }
    if (st.key === 'audit') await logEvent(job.id, `Аудит пауз: вырезаем тишины > ${params.max_gap ?? 3.0} с (pad ${(params.pad ?? 0.6).toString()} с)`);
    if (st.key === 'cover') await logEvent(job.id, job.type === 'short' ? 'scripts/short/thumb_short.py: обложка 1080×1920' : 'Обложка 1280×720 + таймкоды глав');
  }
}

export function ensureWorker() {
  if (g.__mkWorkerTimer) return;
  g.__mkWorkerTimer = setInterval(tick, 1500);
  console.log('[virtual-worker] FIFO loop started (tick 1.5s, single render slot, priority queue)');
}

// ── Демо-данные новых конвейеров (детерминированы по jobId) ────────

const MOCK_HOOKS = [
  { title: 'Що вирішив суд: борг без розписки реально стягнути', quote: 'Чи можна повернути гроші, якщо расписки немає, а є тільки свідки?' },
  { title: 'Це змінює все: свідки тепер підтверджують договір позики', quote: 'Верховний Суд відповів на це питання, і відповідь багатьох здивує.' },
  { title: 'Прецедент, який захистить вас: пені під час війни заборонені', quote: 'Управляюча компанія нарахувала пені за період воєнного стану.' },
  { title: 'Ви маєте це знати: строк оскарження — 6 місяців', quote: 'Скільки часу дає закон на оскарження? Шість місяців, і це критично.' },
  { title: 'Суд став крапку: субсидію не зняти без перевірки', quote: 'Скасувати субсидію можна тільки після документальної перевірки.' },
];

function mockCandidates(jobId: string): HookCandidateSeed[] {
  const h = hashNum(jobId);
  const baseScores = [97, 91, 86, 78, 71];
  const count = 3 + (h % 3); // 3..5 кандидатов
  return Array.from({ length: count }, (_, i) => {
    const start = 60 + ((h >> (i * 3)) % 220) + i * 180;
    const duration = 36 + ((h >> i) % 16); // 36..51 с
    return {
      rank: i + 1,
      start,
      end: start + duration,
      duration,
      title: MOCK_HOOKS[(h + i) % MOCK_HOOKS.length].title,
      quote: MOCK_HOOKS[(h + i) % MOCK_HOOKS.length].quote,
      score: baseScores[i] - ((h >> i) % 3),
      breakdown: {
        hook: 60 + ((h >> (i + 2)) % 35),
        completeness: 80 + ((h >> i) % 20),
        emotion: 55 + ((h >> (i + 1)) % 40),
        retention: 65 + ((h >> (i + 3)) % 30),
      },
    };
  });
}

type HookCandidateSeed = {
  rank: number; start: number; end: number; duration: number;
  title: string; quote: string; score: number;
  breakdown: { hook: number; completeness: number; emotion: number; retention: number };
};

function mockYoutubeMeta(type: string, sourceName: string, params: Record<string, unknown>) {
  const base = String(params.title_line1 || sourceName || 'Рішення суду').slice(0, 90);
  if (type === 'hook_render') {
    const start = Math.round(Number(params.start_sec ?? 0));
    const end = Math.round(Number(params.end_sec ?? 0));
    const tc = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    return {
      title: `${base} #shorts`,
      description: `${base}\n\nФрагмент из источника · таймкод ${tc(start)}–${tc(end)}\nПодписывайтесь — судебная практика простыми словами.\n#shorts #суд #права #КСУ #прецедент`,
      tags: ['shorts', 'суд', 'права людини', 'КСУ', 'прецедент'],
    };
  }
  if (type === 'news_shorts') {
    return {
      title: `${base} — рішення суду просто`,
      description: `${base}\n\nСуть дела проста. Вывод для граждан: как этим защитить свои права.\n\nДжерело: domdara.org\n#правосуддя #верховнийсуд #твоїправа #domdara`,
      tags: ['право', 'суд', 'Верховний Суд', 'права людини', 'прецедент', 'domdara'],
    };
  }
  return {
    title: `${base} #shorts`,
    description: `${base}\n\nПодписывайтесь — судебная практика простыми словами.\n#shorts #суд #права #КСУ`,
    tags: ['shorts', 'суд', 'права людини', 'КСУ'],
  };
}

// Системные показатели для админ-панели
export async function systemStats() {
  const processing = await db.job.findFirst({ where: { status: 'processing' }, orderBy: { startedAt: 'asc' } });
  const queuedCount = await db.job.count({ where: { status: 'queued' } });

  const ramMb = processing?.ramMb ?? WORKER_RAM_IDLE_MB;
  let cpu = 6;
  if (processing) {
    switch (processing.stageKey) {
      case 'transcribe': cpu = 78; break;
      case 'render': cpu = 92; break;
      case 'concat': cpu = 34; break;
      default: cpu = 22;
    }
  }
  const loadavg = (cpu / 100 * 8).toFixed(2);

  return {
    workerBusy: Boolean(processing),
    currentJobId: processing?.id ?? null,
    currentStage: processing?.stageLabel ?? null,
    ramUsedMb: ramMb,
    ramTotalMb: TOTAL_RAM_MB,
    ramBudgetMb: 8192, // лимит docker-compose для воркера
    cpuPercent: cpu,
    loadavg,
    queueLength: queuedCount,
    engineVersion: 'Sereban-glitch-video-montage v2.0.0',
  };
}

export async function ensureWorkerStarted() {
  await ensureWorker();
}
