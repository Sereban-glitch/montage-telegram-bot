// Типы, зеркалящие контракт API (Next.js демо-контур и FastAPI в проде)

export type Role = 'user' | 'admin';
export type JobType = 'short' | 'long';
export type JobStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type SourceType = 'upload' | 'youtube' | 'link';

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
};

export const DEFAULT_LONG: LongParams = {
  max_gap: 3.0,
  pad: 0.6,
  whisper_model: 'large-v3-turbo',
  chapters: true,
  meta_title: '',
};
