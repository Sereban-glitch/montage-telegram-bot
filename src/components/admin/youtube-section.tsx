'use client';

// Раздел «📢 YouTube Канал» (Admin Mode): статус OAuth, история private-выгрузок,
// быстрое копирование заголовка/описания/тегов пакета в буфер обмена.

import { useCallback, useEffect, useState } from 'react';
import { Check, Copy, KeyRound, Loader2, Lock, Youtube } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api } from '@/lib/client-api';
import type { YoutubeSectionData } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function YoutubeSection() {
  const [data, setData] = useState<YoutubeSectionData | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<YoutubeSectionData>('/api/admin/youtube'));
    } catch {
      /* 403 или сеть */
    }
  }, []);

  useEffect(() => {
    const t0 = setTimeout(load, 0);
    return () => clearTimeout(t0);
  }, [load]);

  const copy = async (id: string, text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(id);
      toast({ title: `${what} скопирован${what === 'Теги' ? 'ы' : ''} в буфер` });
      setTimeout(() => setCopied(null), 1600);
    } catch {
      toast({ title: 'Буфер недоступен', description: 'Выделите текст вручную' });
    }
  };

  if (!data) {
    return (
      <div className="flex justify-center py-10 text-sm text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }

  const oauthOk = data.oauth.status === 'connected';

  return (
    <div className="animate-fade-up space-y-4">
      {/* Канал + OAuth */}
      <Card className="gap-0 py-4">
        <CardHeader className="px-4 pb-3">
          <CardTitle className="flex flex-wrap items-center gap-2 text-[14px]">
            <Youtube className="h-4 w-4 text-[#ff3b30]" />
            {data.channel.title}
            <Badge variant="secondary" className="font-mono text-[10px]">{data.channel.handle}</Badge>
            <span
              className={`ml-auto inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold ${
                oauthOk
                  ? 'bg-[#30d158]/15 text-[#30d158] dark:bg-[#30d158]/22'
                  : 'bg-[#ff3b30]/12 text-[#ff3b30] dark:bg-[#ff3b30]/20'
              }`}
            >
              <KeyRound className="h-3 w-3" />
              OAuth {oauthOk ? 'подключён' : data.oauth.status}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">
            Scope: <code className="rounded bg-black/[0.05] px-1 py-0.5 text-[11px] dark:bg-white/[0.08]">{data.oauth.scope}</code>
            {data.oauth.expiresAt && (
              <>
                {' · '}токен до {new Date(data.oauth.expiresAt).toLocaleDateString('ru-RU', { day: '2-digit', month: 'long' })}
              </>
            )}
            . Все выгрузки проходят в статусе <Lock className="inline h-3 w-3" /> <b>private</b> —
            доступ открываете вручную в творческой студии.
          </p>
        </CardContent>
      </Card>

      {/* История выгрузок */}
      {data.uploads.length === 0 ? (
        <Card className="gap-0 py-8">
          <CardContent className="text-center text-[13px] text-muted-foreground">
            Пока ничего не выгружено. Одобренные News Shorts появятся здесь после модерации.
          </CardContent>
        </Card>
      ) : (
        data.uploads.map((u) => (
          <Card key={u.jobId} className="gap-0 py-4">
            <CardHeader className="px-4 pb-2">
              <CardTitle className="flex flex-wrap items-start gap-2 text-[13.5px] leading-snug">
                <span className="min-w-0 flex-1">{u.title}</span>
                <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-[#30d158]/15 px-2.5 py-0.5 text-[10px] font-bold text-[#30d158]">
                  <Lock className="h-2.5 w-2.5" />
                  PRIVATE
                </span>
              </CardTitle>
              <p className="font-mono text-[11px] text-muted-foreground">
                youtu.be/{u.videoId}
                {u.uploadedAt && ` · ${new Date(u.uploadedAt).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
              </p>
            </CardHeader>
            <CardContent className="space-y-2 px-4">
              <div className="rounded-2xl border border-hairline bg-black/[0.02] p-3 dark:bg-white/[0.04]">
                <p className="mb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Описание</p>
                <p className="whitespace-pre-line text-[12px] leading-relaxed">{u.description}</p>
                <p className="mt-2 text-[11.5px] text-primary">{u.tags.join(', ')}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="h-8 rounded-full text-[12px]" onClick={() => copy(`t-${u.jobId}`, u.title, 'Заголовок')}>
                  {copied === `t-${u.jobId}` ? <Check className="h-3.5 w-3.5 text-[#30d158]" /> : <Copy className="h-3.5 w-3.5" />}
                  Заголовок
                </Button>
                <Button size="sm" variant="outline" className="h-8 rounded-full text-[12px]" onClick={() => copy(`d-${u.jobId}`, u.description, 'Описание')}>
                  {copied === `d-${u.jobId}` ? <Check className="h-3.5 w-3.5 text-[#30d158]" /> : <Copy className="h-3.5 w-3.5" />}
                  Описание
                </Button>
                <Button size="sm" variant="outline" className="h-8 rounded-full text-[12px]" onClick={() => copy(`g-${u.jobId}`, u.tags.join(', '), 'Теги')}>
                  {copied === `g-${u.jobId}` ? <Check className="h-3.5 w-3.5 text-[#30d158]" /> : <Copy className="h-3.5 w-3.5" />}
                  Теги
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
