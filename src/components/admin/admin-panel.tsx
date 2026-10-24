'use client';

// Админ-панель: очередь FIFO, ОЗУ/CPU воркера, пользователи и лимиты,
// YouTube-каналы, системные настройки, менеджер витрины.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Ban,
  CheckCircle2,
  Cpu,
  Gauge,
  ListVideo,
  MemoryStick,
  PlayCircle,
  RefreshCw,
  Trash2,
  Users,
  Youtube,
} from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api, fmtRam, fmtTime, STATUS_LABEL } from '@/lib/client-api';
import type { AdminOverview, ShowcaseItem, SystemStats, User } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import type { JobEvent } from '@/lib/types';

type LogEvent = JobEvent;

export function AdminPanel({ user, onBack }: { user: User; onBack: () => void }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [users, setUsers] = useState<(User & { _count: { jobs: number } })[]>([]);
  const [showcase, setShowcase] = useState<ShowcaseItem[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const logRef = useRef<HTMLDivElement>(null);

  const loadOverview = useCallback(async () => {
    try {
      const data = await api<AdminOverview>('/api/admin/overview');
      setOverview(data);
    } catch {
      /* 403 если не админ */
    }
  }, []);

  const loadEvents = useCallback(async () => {
    try {
      const { events: e } = await api<{ events: LogEvent[] }>('/api/admin/events?limit=60');
      setEvents(e);
    } catch {
      /* noop */
    }
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const { users: u } = await api<{ users: (User & { _count: { jobs: number } })[] }>('/api/admin/users');
      setUsers(u);
    } catch {
      /* noop */
    }
  }, []);

  const loadShowcase = useCallback(async () => {
    try {
      const { items } = await api<{ items: ShowcaseItem[] }>('/api/showcase');
      setShowcase(items);
    } catch {
      /* noop */
    }
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      const { settings: s } = await api<{ settings: { key: string; value: string }[] }>('/api/admin/settings');
      setSettings(Object.fromEntries(s.map((x) => [x.key, x.value])));
    } catch {
      /* noop */
    }
  }, []);

  useEffect(() => {
    // первичная загрузка — асинхронно, чтобы не гонять setState синхронно в эффекте
    const t0 = setTimeout(() => {
      loadOverview();
      loadEvents();
      loadUsers();
      loadShowcase();
      loadSettings();
    }, 0);
    const t = setInterval(() => {
      if (document.hidden) return;
      loadOverview();
      loadEvents();
    }, 2500);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [loadOverview, loadEvents, loadUsers, loadShowcase, loadSettings]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: 0 });
  }, [events]);

  if (!overview) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground text-sm">
        Загрузка телеметрии…
      </div>
    );
  }

  const sys: SystemStats = overview.system;
  const ramPct = Math.round((sys.ramUsedMb / sys.ramTotalMb) * 100);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-30 bg-card/90 backdrop-blur-md border-b border-border">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={onBack} aria-label="Вернуться в приложение">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1 min-w-0">
            <h1 className="font-bold leading-tight">Админ-панель · Монтажная Кухня</h1>
            <p className="text-[11px] text-muted-foreground truncate">{sys.engineVersion}</p>
          </div>
          <Badge variant={sys.workerBusy ? 'default' : 'secondary'} className="shrink-0">
            {sys.workerBusy ? 'Воркер занят' : 'Воркер свободен'}
          </Badge>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-5 space-y-5 pb-16">
        {/* Сводные карточки */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <StatCard icon={<ListVideo className="h-4.5 w-4.5" />} label="В очереди" value={String(sys.queueLength)} hint={`сегодня задач: ${overview.todayCount}`} />
          <StatCard
            icon={<MemoryStick className="h-4.5 w-4.5" />}
            label="ОЗУ воркера"
            value={fmtRam(sys.ramUsedMb) ?? '—'}
            hint={`лимит контейнера ${fmtRam(sys.ramBudgetMb)} · всего 12 ГБ`}
          >
            <Progress value={Math.min(100, (sys.ramUsedMb / sys.ramTotalMb) * 100)} className="h-1.5 mt-2" />
          </StatCard>
          <StatCard icon={<Cpu className="h-4.5 w-4.5" />} label="CPU" value={`${sys.cpuPercent}%`} hint={`loadavg ${sys.loadavg}`}>
            <Progress value={sys.cpuPercent} className="h-1.5 mt-2" />
          </StatCard>
          <StatCard icon={<Users className="h-4.5 w-4.5" />} label="Пользователи" value={String(overview.usersCount)} hint={`готово: ${overview.completedCount} · ошибок: ${overview.failedCount}`} />
        </div>

        <Tabs defaultValue="queue">
          <TabsList className="w-full justify-start overflow-x-auto h-auto flex-nowrap">
            <TabsTrigger value="queue">Очередь</TabsTrigger>
            <TabsTrigger value="users">Пользователи</TabsTrigger>
            <TabsTrigger value="channels">Каналы</TabsTrigger>
            <TabsTrigger value="settings">Настройки</TabsTrigger>
            <TabsTrigger value="showcase">Витрина</TabsTrigger>
          </TabsList>

          {/* ── Очередь + терминал ─────────────────────────── */}
          <TabsContent value="queue" className="space-y-4 mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Gauge className="h-4 w-4 text-primary" /> FIFO-очередь рендера
                  <span className="text-xs font-normal text-muted-foreground">одновременных рендеров: 1 (защита 12 ГБ ОЗУ)</span>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-14">#</TableHead>
                        <TableHead>Тип</TableHead>
                        <TableHead>Источник</TableHead>
                        <TableHead className="hidden md:table-cell">Пользователь</TableHead>
                        <TableHead>Этап</TableHead>
                        <TableHead className="w-28">Прогресс</TableHead>
                        <TableHead className="w-24" />
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {overview.jobs.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={7} className="text-center text-muted-foreground text-sm py-8">
                            Очередь пуста — воркер ждёт задачи
                          </TableCell>
                        </TableRow>
                      )}
                      {overview.jobs.map((job) => (
                        <TableRow key={job.id}>
                          <TableCell className="font-mono text-xs">{job.status === 'processing' ? '▶' : job.queuePosition}</TableCell>
                          <TableCell>
                            <Badge variant={job.type === 'long' ? 'secondary' : 'default'} className="text-[10px]">
                              {job.type.toUpperCase()}
                            </Badge>
                          </TableCell>
                          <TableCell className="max-w-[180px] truncate text-xs">{job.sourceName ?? job.sourceUrl ?? '—'}</TableCell>
                          <TableCell className="hidden md:table-cell text-xs text-muted-foreground">
                            {job.user?.firstName ?? job.user?.username ?? job.user?.telegramId}
                          </TableCell>
                          <TableCell className="text-xs">
                            {job.stageLabel ?? '—'}
                            <span className="block text-[10px] text-muted-foreground">
                              {STATUS_LABEL[job.status]} · {fmtTime(job.createdAt)}
                            </span>
                          </TableCell>
                          <TableCell>
                            <Progress value={job.progress} className="h-1.5" />
                            <span className="text-[10px] text-muted-foreground tabular-nums">{job.progress}% · {fmtRam(job.ramMb)}</span>
                          </TableCell>
                          <TableCell>
                            {job.status !== 'processing' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive"
                                aria-label="Убрать из очереди"
                                onClick={async () => {
                                  await api(`/api/jobs/${job.id}`, { method: 'DELETE' }).catch(() => undefined);
                                  loadOverview();
                                }}
                              >
                                <Ban className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <PlayCircle className="h-4 w-4 text-primary" /> Журнал воркера
                  <RefreshCw className="h-3.5 w-3.5 text-muted-foreground animate-spin [animation-duration:3s]" />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  ref={logRef}
                  className="scrollbar-thin h-64 overflow-y-auto rounded-lg bg-black/80 dark:bg-black/60 border border-border p-3 font-mono text-[11px] leading-relaxed"
                >
                  {events.map((e) => (
                    <p key={e.id} className={e.level === 'error' ? 'text-red-400' : e.level === 'warn' ? 'text-amber-400' : 'text-emerald-300/90'}>
                      <span className="text-white/40">[{fmtTime(e.createdAt)}]</span>{' '}
                      <span className="text-white/35">{e.job ? `${e.job.type.toUpperCase()} · ` : 'SYS · '}</span>
                      {e.message}
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Пользователи ──────────────────────────────── */}
          <TabsContent value="users" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Пользователи и лимиты</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-border overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Кто</TableHead>
                        <TableHead className="hidden sm:table-cell">Telegram ID</TableHead>
                        <TableHead className="w-24">Роль</TableHead>
                        <TableHead className="w-28">Лимит/день</TableHead>
                        <TableHead className="hidden md:table-cell">Задач</TableHead>
                        <TableHead className="w-20">Блок</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {users.map((u) => (
                        <UserRow key={u.id} u={u} reload={loadUsers} />
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Каналы ────────────────────────────────────── */}
          <TabsContent value="channels" className="mt-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {overview.channels.map((ch) => (
                <Card key={ch.id}>
                  <CardContent className="p-4 flex items-start gap-3">
                    <div className="h-10 w-10 rounded-xl bg-red-500/15 flex items-center justify-center shrink-0">
                      <Youtube className="h-5 w-5 text-red-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{ch.channelTitle ?? '—'}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {ch.handle} · {ch.channelId}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        профиль движка: profiles/{ch.profileKey}.json
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {ch.status === 'connected' ? (
                        <Badge className="gap-1 bg-emerald-600 text-white text-[10px]"><CheckCircle2 className="h-3 w-3" /> подключен</Badge>
                      ) : ch.status === 'error' ? (
                        <Badge variant="destructive" className="text-[10px]">ошибка OAuth</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-[10px]">ожидание</Badge>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={async () => {
                          await api('/api/admin/channels', {
                            method: 'PATCH',
                            body: JSON.stringify({ id: ch.id, status: ch.status === 'connected' ? 'pending' : 'connected' }),
                          });
                          loadOverview();
                        }}
                      >
                        {ch.status === 'connected' ? 'Отключить' : 'Подключить'}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
              {overview.channels.length === 0 && (
                <p className="text-sm text-muted-foreground">Каналы ещё не подключены. OAuth-токены хранятся на сервере, см. DEPLOYMENT.md.</p>
              )}
            </div>
          </TabsContent>

          {/* ── Настройки ─────────────────────────────────── */}
          <TabsContent value="settings" className="mt-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Системные настройки</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 max-w-md">
                <label className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2.5">
                  <span className="text-sm">
                    Воркер принимает задачи
                    <span className="block text-xs text-muted-foreground">выключите на время техработ</span>
                  </span>
                  <Switch
                    checked={settings.worker_enabled !== 'false'}
                    onCheckedChange={async (v) => {
                      await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ worker_enabled: String(v) }) });
                      loadSettings();
                      toast({ title: v ? 'Воркер включён' : 'Воркер на паузе' });
                    }}
                    aria-label="Воркер включен"
                  />
                </label>
                <SettingInput
                  label="Лимит задач в день (новые пользователи)"
                  value={settings.global_daily_limit ?? '3'}
                  onSave={async (v) => {
                    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ global_daily_limit: v }) });
                    loadSettings();
                  }}
                />
                <SettingInput
                  label="Максимальный размер файла, МБ"
                  value={settings.max_file_mb ?? '2048'}
                  onSave={async (v) => {
                    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ max_file_mb: v }) });
                    loadSettings();
                  }}
                />
                <SettingInput
                  label="Бюджет ОЗУ воркера, МБ (docker mem_limit)"
                  value={settings.worker_ram_budget_mb ?? '8192'}
                  onSave={async (v) => {
                    await api('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ worker_ram_budget_mb: v }) });
                    loadSettings();
                  }}
                />
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Менеджер витрины ──────────────────────────── */}
          <TabsContent value="showcase" className="mt-4">
            <ShowcaseManager items={showcase} reload={loadShowcase} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground text-xs">
          <span className="text-primary">{icon}</span>
          {label}
        </div>
        <p className="text-2xl font-bold mt-1.5 tabular-nums">{value}</p>
        {children}
        {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function SettingInput({ label, value, onSave }: { label: string; value: string; onSave: (v: string) => Promise<void> }) {
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const [prevValue, setPrevValue] = useState(value);
  if (prevValue !== value) {
    setPrevValue(value);
    setV(value);
  }
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="flex gap-2">
        <Input value={v} onChange={(e) => setV(e.target.value)} inputMode="numeric" />
        <Button
          size="sm"
          variant="secondary"
          disabled={busy || v === value}
          onClick={async () => {
            setBusy(true);
            await onSave(v).catch(() => undefined);
            setBusy(false);
            toast({ title: 'Настройка сохранена' });
          }}
        >
          Сохранить
        </Button>
      </div>
    </div>
  );
}

function UserRow({ u, reload }: { u: User & { _count: { jobs: number } }; reload: () => void }) {
  const [limit, setLimit] = useState(String(u.dailyLimit));
  const [prevLimit, setPrevLimit] = useState(u.dailyLimit);
  if (prevLimit !== u.dailyLimit) {
    setPrevLimit(u.dailyLimit);
    setLimit(String(u.dailyLimit));
  }

  const patch = async (data: Record<string, unknown>) => {
    await api('/api/admin/users', { method: 'PATCH', body: JSON.stringify({ id: u.id, ...data }) }).catch(() => undefined);
    reload();
  };

  return (
    <TableRow className={u.isBlocked ? 'opacity-50' : undefined}>
      <TableCell>
        <p className="text-sm font-medium truncate">{u.firstName ?? '—'}</p>
        <p className="text-xs text-muted-foreground">@{u.username ?? u.telegramId} · {u.dailyUsed}/{u.dailyLimit} сегодня</p>
      </TableCell>
      <TableCell className="hidden sm:table-cell font-mono text-xs text-muted-foreground">{u.telegramId}</TableCell>
      <TableCell>
        <Select value={u.role} onValueChange={(role) => patch({ role })}>
          <SelectTrigger className="h-8 text-xs" aria-label="Роль"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="user">user</SelectItem>
            <SelectItem value="admin">admin</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Input value={limit} onChange={(e) => setLimit(e.target.value)} className="h-8 w-14 text-xs" inputMode="numeric" aria-label="Лимит в день" />
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs" disabled={limit === String(u.dailyLimit)} onClick={() => patch({ dailyLimit: Number(limit) })}>
            ✓
          </Button>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell text-xs text-muted-foreground">{u._count.jobs}</TableCell>
      <TableCell>
        <Switch checked={u.isBlocked} onCheckedChange={(v) => patch({ isBlocked: v })} aria-label="Блокировка" />
      </TableCell>
    </TableRow>
  );
}

function ShowcaseManager({ items, reload }: { items: ShowcaseItem[]; reload: () => void }) {
  const [form, setForm] = useState({ kind: 'short', title: '', subtitle: '', thumbUrl: '/showcase/short-court.png', videoUrl: '/demo/final_short.mp4' });
  const [busy, setBusy] = useState(false);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Работы в витрине ({items.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-3 rounded-lg border border-border p-2">
              <div className="h-12 w-9 rounded bg-muted bg-cover bg-center shrink-0" style={{ backgroundImage: `url('${it.thumbUrl}')` }} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{it.title}</p>
                <p className="text-[10px] text-muted-foreground">{it.kind.toUpperCase()} · {it.views} просм. · /{it.thumbUrl.split('/').pop()}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className={`h-8 w-8 p-0 ${it.featured ? 'text-amber-500' : 'text-muted-foreground'}`}
                aria-label="Сделать рекомендованной"
                onClick={async () => {
                  await api('/api/admin/showcase', { method: 'PATCH', body: JSON.stringify({ id: it.id, featured: !it.featured }) });
                  reload();
                }}
              >
                ★
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                aria-label="Удалить из витрины"
                onClick={async () => {
                  await api(`/api/admin/showcase?id=${it.id}`, { method: 'DELETE' });
                  reload();
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Добавить работу</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Select value={form.kind} onValueChange={(kind) => setForm((f) => ({ ...f, kind }))}>
            <SelectTrigger aria-label="Тип работы"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="short">Short (вертикальное)</SelectItem>
              <SelectItem value="long">Long (1280×720)</SelectItem>
            </SelectContent>
          </Select>
          <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Заголовок" />
          <Input value={form.subtitle} onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))} placeholder="Подзаголовок" />
          <Select value={form.thumbUrl} onValueChange={(thumbUrl) => setForm((f) => ({ ...f, thumbUrl }))}>
            <SelectTrigger aria-label="Обложка"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="/showcase/short-court.png">short-court.png</SelectItem>
              <SelectItem value="/showcase/short-street.png">short-street.png</SelectItem>
              <SelectItem value="/showcase/short-press.png">short-press.png</SelectItem>
              <SelectItem value="/showcase/short-mic.png">short-mic.png</SelectItem>
              <SelectItem value="/showcase/long-session.png">long-session.png</SelectItem>
              <SelectItem value="/showcase/long-lecture.png">long-lecture.png</SelectItem>
            </SelectContent>
          </Select>
          <Input value={form.videoUrl} onChange={(e) => setForm((f) => ({ ...f, videoUrl: e.target.value }))} placeholder="/demo/final_short.mp4" />
          <Button
            className="w-full"
            disabled={busy || !form.title}
            onClick={async () => {
              setBusy(true);
              try {
                await api('/api/admin/showcase', { method: 'POST', body: JSON.stringify(form) });
                setForm((f) => ({ ...f, title: '', subtitle: '' }));
                reload();
                toast({ title: 'Работа добавлена в витрину' });
              } finally {
                setBusy(false);
              }
            }}
          >
            Добавить
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
