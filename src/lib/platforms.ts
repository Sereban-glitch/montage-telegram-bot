// Платформы-источники для ссылок (P0 «мультиплатформенность»).
// yt-dlp умеет 1000+ сайтов — здесь топ-платформы для распознавания в UI,
// любые другие http(s)-ссылки тоже принимаются (generic).

export interface Platform {
  id: string;
  name: string;
  emoji: string;
  /** Регулярка на хостин/путь ссылки */
  re: RegExp;
}

export const PLATFORMS: readonly Platform[] = [
  { id: 'youtube', name: 'YouTube', emoji: '▶️', re: /(?:^|\.)(?:youtube\.com|youtu\.be|youtube\.shorts)(?:$|\/)/i },
  { id: 'tiktok', name: 'TikTok', emoji: '🎵', re: /(?:^|\.)(?:tiktok\.com|vt\.tiktok\.com)(?:$|\/)/i },
  { id: 'instagram', name: 'Instagram', emoji: '📸', re: /(?:^|\.)(?:instagram\.com|instagr\.am)(?:$|\/)/i },
  { id: 'x', name: 'X / Twitter', emoji: '𝕏', re: /(?:^|\.)(?:twitter\.com|x\.com|t\.co)(?:$|\/)/i },
  { id: 'vimeo', name: 'Vimeo', emoji: '🎬', re: /(?:^|\.)(?:vimeo\.com)(?:$|\/)/i },
  { id: 'facebook', name: 'Facebook', emoji: '👤', re: /(?:^|\.)(?:facebook\.com|fb\.watch)(?:$|\/)/i },
  { id: 'twitch', name: 'Twitch', emoji: '🟣', re: /(?:^|\.)(?:twitch\.tv)(?:$|\/)/i },
  { id: 'rutube', name: 'Rutube', emoji: '🇷🇺', re: /(?:^|\.)(?:rutube\.ru)(?:$|\/)/i },
  { id: 'vk', name: 'VK Видео', emoji: '🆔', re: /(?:^|\.)(?:vk\.com|vkvideo\.ru)(?:$|\/)/i },
  { id: 'ok', name: 'Одноклассники', emoji: '🟠', re: /(?:^|\.)(?:ok\.ru)(?:$|\/)/i },
  { id: 'dzen', name: 'Дзен', emoji: '♾️', re: /(?:^|\.)(?:dzen\.ru|zen\.yandex\.ru)(?:$|\/)/i },
];

const DIRECT_FILE_RE = /\.(mp4|mkv|mov|webm|m4v|mp3|m4a|wav|aac)(\?|$)/i;

export interface DetectedSource {
  kind: 'platform' | 'file' | 'generic';
  id: string;
  /** Человекочитаемое имя для чипа в UI */
  label: string;
  emoji: string;
}

/** Распознать ссылку: платформа → прямой файл → generic (yt-dlp всё равно попробует). */
export function detectSource(url: string): DetectedSource | null {
  const clean = url.trim();
  if (!/^https?:\/\//i.test(clean)) return null;
  for (const p of PLATFORMS) {
    if (p.re.test(clean)) return { kind: 'platform', id: p.id, label: p.name, emoji: p.emoji };
  }
  if (DIRECT_FILE_RE.test(clean)) {
    return { kind: 'file', id: 'file', label: 'MP4 / аудио', emoji: '📄' };
  }
  try {
    const host = new URL(clean).hostname.replace(/^www\./, '');
    return { kind: 'generic', id: 'generic', label: host, emoji: '🔗' };
  } catch {
    return null;
  }
}

/** Короткая подпись-подсказка со списком платформ (для плейсхолдеров и чипов). */
export const PLATFORM_HINT =
  'YouTube · TikTok · Instagram · Vimeo · X · Facebook · RuTube · VK · Дзен';
