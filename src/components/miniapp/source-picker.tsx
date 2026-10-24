'use client';

// Общая зона загрузки: файл ИЛИ ссылка (YouTube / прямая) — как в ТЗ бота

import { useRef, useState } from 'react';
import { FileVideo, Link2, UploadCloud, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

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
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  return (
    <div className="space-y-3">
      <Tabs value={mode} onValueChange={(v) => onModeChange(v as SourceMode)}>
        <TabsList className="grid grid-cols-3 w-full">
          <TabsTrigger value="upload" className="gap-1.5 text-xs">
            <UploadCloud className="h-3.5 w-3.5" /> Файл
          </TabsTrigger>
          <TabsTrigger value="youtube" className="gap-1.5 text-xs">
            <Link2 className="h-3.5 w-3.5" /> YouTube
          </TabsTrigger>
          <TabsTrigger value="link" className="gap-1.5 text-xs">
            <Link2 className="h-3.5 w-3.5" /> Ссылка
          </TabsTrigger>
        </TabsList>
      </Tabs>

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
            className={`w-full rounded-xl border-2 border-dashed px-4 py-8 flex flex-col items-center gap-2 transition-colors min-h-[120px] ${
              dragOver ? 'border-primary bg-primary/10' : 'border-input hover:border-primary/60 hover:bg-muted/50'
            }`}
          >
            <FileVideo className="h-8 w-8 text-primary" />
            <span className="text-sm font-medium">Нажмите или перетащите видео</span>
            <span className="text-xs text-muted-foreground">MP4, MKV, MOV · до 2 ГБ · аудио тоже подойдёт</span>
          </button>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
            <div className="h-10 w-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0">
              <FileVideo className="h-5 w-5 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{file.name}</p>
              <p className="text-xs text-muted-foreground">{(file.size / 1048576).toFixed(1)} МБ</p>
            </div>
            <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" aria-label="Убрать файл" onClick={() => onFileChange(null)}>
              <X className="h-4 w-4" />
            </Button>
          </div>
        )
      ) : (
        <Input
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          placeholder={mode === 'youtube' ? 'https://youtube.com/watch?v=…' : 'https://example.com/video.mp4'}
          inputMode="url"
          aria-label="Ссылка на видео"
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
