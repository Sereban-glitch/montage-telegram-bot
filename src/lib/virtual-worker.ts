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

const TOTAL_MS = {
  short: 46_000, // демо-скорость конвейера
  long: 74_000,
};

const WORKER_RAM_IDLE_MB = 2100;
const TOTAL_RAM_MB = 12288;

const g = globalThis as unknown as { __mkWorkerTimer?: NodeJS.Timeout };

function hashNum(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function stagesFor(type: string): StageSpec[] {
  return type === 'long' ? LONG_STAGES : SHORT_STAGES;
}

function stageAt(type: string, frac: number): StageSpec {
  const stages = stagesFor(type);
  for (const st of stages) if (frac >= st.from && frac < st.to) return st;
  return stages[stages.length - 1];
}

// Правдоподобная имитация потребления ОЗУ по этапам конвейера
function ramForStage(type: string, frac: number): number {
  const st = stageAt(type, frac);
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

    const processing = await db.job.findFirst({
      where: { status: 'processing' },
      orderBy: { startedAt: 'asc' },
    });

    if (processing) {
      await advance(processing);
    } else if (workerEnabled) {
      const next = await db.job.findFirst({
        where: { status: 'queued' },
        orderBy: { createdAt: 'asc' },
      });
      if (next) await start(next.id);
    }

    // Пересчёт позиций в очереди
    const queued = await db.job.findMany({ where: { status: 'queued' }, orderBy: { createdAt: 'asc' } });
    for (let i = 0; i < queued.length; i++) {
      if (queued[i].queuePosition !== i + 1) {
        await db.job.update({ where: { id: queued[i].id }, data: { queuePosition: i + 1 } });
      }
    }
  } catch (e) {
    console.error('[virtual-worker] tick error', e);
  }
}

async function start(jobId: string) {
  const job = await db.job.update({
    where: { id: jobId },
    data: { status: 'processing', startedAt: new Date(), stageKey: 'download', stageLabel: 'Загрузка видео', progress: 0, queuePosition: 0, ramMb: 2400 },
  });
  await logEvent(jobId, `Воркер: задача ${job.type === 'long' ? 'Long' : 'Short'} «${job.sourceName ?? job.sourceUrl ?? jobId}» принята в слот рендера (FIFO)`);
  await logEvent(jobId, 'Source: подготовка рабочего каталога /data/media/' + jobId);
}

async function advance(job: { id: string; type: string; startedAt: Date | null; progress: number; stageKey: string | null; params: string }) {
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
    const thumb = job.type === 'long' ? '/showcase/long-session.png' : '/showcase/short-court.png';
    const resultUrl = '/demo/final_short.mp4';
    await db.job.update({
      where: { id: job.id },
      data: {
        status: 'completed',
        progress: 100,
        stageKey: 'done',
        stageLabel: 'Готово — final.mp4',
        resultUrl,
        thumbUrl: thumb,
        ramMb: WORKER_RAM_IDLE_MB,
        notified: true,
        completedAt: new Date(),
      },
    });
    await logEvent(job.id, 'Движок: loudnorm I=-14 TP=-1.5 LRA=11 применён, final.mp4 собран');
    await logEvent(job.id, 'Бот: файл final.mp4 отправлен пользователю в чат, временные файлы очищены');
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
  console.log('[virtual-worker] FIFO loop started (tick 1.5s, single render slot)');
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
