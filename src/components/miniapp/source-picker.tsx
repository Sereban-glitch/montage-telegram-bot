'use client';

// Общая зона загрузки: файл ИЛИ ссылка (YouTube / прямая) — как в ТЗ бота.
// Стиль: iOS Segmented Control + стеклянная drop-зона.

import { useRef, useState } from 'react';
import { FileVideo, Link2, UploadCloud, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import { Input } from '@/components/ui/input';
import { Segmented } from '@/components/ui/segmented';

export type SourceMode = 'upload' | 'youtube' | 'link';

export function SourcePicker({
  mode,
  onModeChange,
  file,
  onFileChange,
  url,
  onUrlChange,
}: {
  mode: SourceMode;
  onModeChange: (m: SourceMode) => void;
  file: File | null;
  onFileChange: (f: File | null) => void;
  url: string;
  onUrlChange: (u: string) => void;
}) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const MODE_OPTIONS: { value: SourceMode; label: React.ReactNode }[] = [
    {
      value: 'upload',
      label: (
        <>
          <UploadCloud className="h-3.5 w-3.5" /> {t.source.file}
        </>
      ),
    },
    {
      value: 'youtube',
      label: (
        <>
          <Link2 className="h-3.5 w-3.5" /> YouTube
        </>
      ),
    },
    {
      value: 'link',
      label: (
        <>
          <Link2 className="h-3.5 w-3.5" /> {t.source.link}
        </>
      ),
    },
  ];

  return (
    <div className="space-y-3">
      <Segmented
        value={mode}
        onValueChange={onModeChange}
        options={MODE_OPTIONS}
        ariaLabel={t.source.aria}
      />

      {mode === 'upload' ? (
        !file ? (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDragOver(true);
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              const f = e.dataTransfer.files?.[0];
              if (f) onFileChange(f);
            }}
            className={`tap-none flex w-full min-h-[124px] flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-7 transition-all duration-200 ${
              dragOver
                ? 'scale-[1.01] border-primary bg-primary/10 shadow-glow'
                : 'border-hairline bg-black/[0.025] hover:border-primary/50 hover:bg-primary/[0.05] dark:bg-white/[0.04]'
            }`}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary/12 dark:bg-primary/20">
              <FileVideo className="h-5.5 w-5.5 text-primary" />
            </span>
            <span className="text-[13px] font-semibold">{t.source.dropTitle}</span>
            <span className="text-[11px] text-muted-foreground">{t.source.dropHint}</span>
          </button>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl border border-hairline bg-black/[0.025] px-3.5 py-3 dark:bg-white/[0.04]">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/12 dark:bg-primary/20">
              <FileVideo className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{file.name}</p>
              <p className="text-[11px] text-muted-foreground">
                {(file.size / 1048576).toFixed(1)} МБ
              </p>
            </div>
            <button
              type="button"
              aria-label={t.source.removeFile}
              onClick={() => onFileChange(null)}
              className="tap-none flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-black/[0.05] text-muted-foreground transition-colors hover:bg-destructive/12 hover:text-destructive dark:bg-white/[0.10] dark:hover:bg-destructive/25"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      ) : (
        <Input
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder={mode === 'youtube' ? 'https://youtube.com/watch?v=…' : t.source.urlPlaceholder}
          inputMode="url"
          aria-label={t.source.urlAria}
        />
      )}

      <input
        ref={inputRef}
        type="file"
        accept="video/*,audio/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0] ?? null;
          onFileChange(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}
