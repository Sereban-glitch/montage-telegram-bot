// Типы, зеркалящие контракт API (Next.js демо-контур и FastAPI в проде)

export type Role = 'user' | 'admin';
export type JobType = 'short' | 'long' | 'hook_analysis' | 'hook_render' | 'news_shorts';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type SourceType = 'upload' | 'youtube' | 'link';
// Human-in-the-Loop для news_shorts (Фича №2)
export type ApprovalStatus = 'pending' | 'approved' | 'regenerate' | 'regenerated' | 'rejected' | 'rejected_done' | 'uploaded' | 'upload_failed';

export interface User {
  id: string;
  telegramId: string;
  username: string | null;
  firstName: string | null;
  photoUrl: string | null;
  role: Role;
  isBlocked: boolean;
  dailyUsed: number;
  dailyLimit: number;
}

export interface JobEvent {
  id: string;
  jobId: string | null;
  level: 'info' | 'warn' | 'error';
  message: string;
  createdAt: string;
  job?: { type: JobType };
}

export interface Job {
  id: string;
  userId: string;
  type: JobType;
  status: JobStatus;
  priority: number; // 10 = интерактив (друзья, всегда первыми), 1 = фон (domdara)
  approvalStatus: ApprovalStatus | null; // модерация news_shorts
  stageKey: string | null;
  stageLabel: string | null;
  progress: number;
  queuePosition: number;
  sourceType: SourceType;
  sourceName: string | null;
  sourceUrl: string | null;
  sizeMb: number | null;
  params: string;
  resultUrl: string | null;
  thumbUrl: string | null;
  error: string | null;
  ramMb: number | null;
  notified: boolean;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  user?: { firstName: string | null; username: string | null; telegramId: string };
  events?: JobEvent[];
}

// Кандидат AI Hook Finder (Фича №1) — живёт в params.completed hook_analysis-задачи
export interface HookCandidate {
  rank: number;
  start: number;
  end: number;
  duration: number;
  title: string;
  quote: string;
  score: number; // Virality Score 60..99
  raw?: number;
  breakdown?: { hook: number; completeness: number; emotion: number; retention: number };
  /** Превью-кадр фрагмента 9:16 (P0: кадры в хук-карточках, как Opus Clip) */
  thumb?: string;
  /** 3 варианта названия A/B/C — клик выбирает титул ролика (P2) */
  titles?: string[];
  /** 10-секундное превью-видео фрагмента (P1) */
  previewUrl?: string;
}

// YouTube-пакет к готовому ролику (в params.youtube_meta)
export interface YoutubeMeta {
  title: string;
  description: string;
  tags: string[];
}

export interface ShowcaseItem {
  id: string;
  kind: JobType;
  title: string;
  subtitle: string | null;
  thumbUrl: string;
  videoUrl: string | null;
  durationSec: number | null;
  views: number;
  featured: boolean;
  sort: number;
  /** Готовый пакет для YouTube (название/описание/теги) — копируется в 1 клик из модалки */
  youtubeMeta?: YoutubeMeta | null;
}

export interface Channel {
  id: string;
  userId: string;
  provider: string;
  channelId: string | null;
  channelTitle: string | null;
  handle: string | null;
  profileKey: string | null;
  status: 'pending' | 'connected' | 'error';
  user?: { firstName: string | null; username: string | null };
}

export interface SystemStats {
  workerBusy: boolean;
  currentJobId: string | null;
  currentStage: string | null;
  ramUsedMb: number;
  ramTotalMb: number;
  ramBudgetMb: number;
  cpuPercent: number;
  loadavg: string;
  queueLength: number;
  engineVersion: string;
}

export interface AdminOverview {
  jobs: Job[];
  system: SystemStats;
  usersCount: number;
  completedCount: number;
  failedCount: number;
  todayCount: number;
  channels: Channel[];
}

export interface ShortsParams {
  title_line1: string;
  title_line2: string;
  overlay_label: string;
  pill_text: string;
  speech_lang: string; // uk | ru | en
  subtitle_lang: string; // ru | uk | en | off
  bilingual: boolean;
  cover_frame: number; // 0..100 — позиция кадра обложки, %
  // ── Улучшения монтажа (P1–P3, передаются в params → воркер) ──
  remove_silence: boolean; // ✂️ вырезка пауз silencedetect -38 dB / 450 мс
  sfx: boolean; // 🥁 лёгкие SFX-акценты на склейках (процедурные, CC0)
  music: boolean; // 🎵 фоновая музыка с автоприглушением (sidechain)
  dub: boolean; // 🗣 авто-дубляж RU⇄UA (edge-tts + LLM-перевод)
}

export interface LongParams {
  max_gap: number; // сек, паузы длиннее — вырезаем
  pad: number; // отступ при склейке
  whisper_model: string; // small | large-v3-turbo
  chapters: boolean;
  meta_title: string;
}

export const DEFAULT_SHORTS: ShortsParams = {
  title_line1: '',
  title_line2: '',
  overlay_label: 'КСУ • сегодня',
  pill_text: 'ЩО ЦЕ ЗМІНЮЄ?',
  speech_lang: 'uk',
  subtitle_lang: 'ru',
  bilingual: true,
  cover_frame: 35,
  remove_silence: true,
  sfx: false,
  music: false,
  dub: false,
};

export const DEFAULT_LONG: LongParams = {
  max_gap: 3.0,
  pad: 0.6,
  whisper_model: 'large-v3-turbo',
  chapters: true,
  meta_title: '',
};

// ── Фича №2: Domdara News Hub (админ-раздел) ─────────────────
export type NewsState = 'new' | 'queued' | 'rendered' | 'approved' | 'rejected' | 'regenerate' | 'failed' | 'skipped';

export interface NewsArticle {
  id: string;
  guid: string;
  url: string;
  title: string;
  snippet: string;
  state: NewsState;
  jobId: string | null;
  publishedAt: string | null;
  createdAt: string;
  job?: Job | null; // связанная задача (прогресс/результат/сценарий)
}

// Раздел «📢 YouTube Канал» в админке
export interface YoutubeUpload {
  jobId: string;
  title: string;
  description: string;
  tags: string[];
  videoId: string | null;
  privacy: 'private' | 'public' | 'unlisted';
  uploadedAt: string | null;
  kind: JobType;
}

export interface YoutubeSectionData {
  channel: { handle: string; title: string };
  oauth: { status: 'connected' | 'expired' | 'missing'; expiresAt: string | null; scope: string };
  uploads: YoutubeUpload[];
}
