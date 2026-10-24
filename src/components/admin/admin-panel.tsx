'use client';

// Админ-панель: очередь FIFO, ОЗУ/CPU воркера, пользователи и лимиты,
// YouTube-каналы, системные настройки, менеджер витрины.
// Дизайн: iOS Settings — стеклянные сводки, сегментированный контрол, пилюли.

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
import type { AdminOverview, JobEvent, ShowcaseItem, SystemStats, User } from '@/lib/types';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Segmented } from '@/components/ui/segmented';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type LogEvent = JobEvent;
type AdminTab = 'queue' | 'users' | 'channels' | 'settings' | 'showcase';

const ADMIN_TABS: { value: AdminTab; label: string }[] = [
  { value: 'queue', label: 'Очередь' },
  { value: 'users', label: 'Юзеры' },
  { value: 'channels', label: 'Каналы' },
  { value: 'settings', label: 'Настройки' },
  { value: 'showcase', label: 'Витрина' },
];

export function AdminPanel({ user, onBack }: { user: User; onBack: () => void }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [events, setEvents] = useState<LogEvent[]>([]);
  const [users, setUsers] = useState<(User & { _count: { jobs: number } })[]>([]);
  const [showcase, setShowcase] = useState<ShowcaseItem[]>([]);
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [adminTab, setAdminTab] = useState<AdminTab>('queue');
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
      <div className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Загрузка телеметрии…
      </div>
    );
  }

  const sys: SystemStats = overview.system;

  return (
    <div className="min-h-screen bg-background">
      {/* Шапка: матовое стекло */}
      <header className="glass-strong sticky top-0 z-30 border-b hairline">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Button
            variant="ghost"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-full bg-black/[0.04] text-muted-foreground hover:bg-black/[0.08] dark:bg-white/[0.08] dark:hover:bg-white/[0.14]"
            onClick={onBack}
            aria-label="Вернуться в приложение"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-bold leading-tight tracking-tight">Админ-панель</h1>
            <p className="truncate text-[11px] text-muted-foreground">{sys.engineVersion}</p>
          </div>
          <span
            className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-semibold ${
              sys.workerBusy
                ? 'bg-primary/12 text-primary dark:bg-primary/22'
                : 'bg-success/15 text-success dark:bg-success/22'
            }`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${sys.workerBusy ? 'animate-pulse bg-primary' : 'bg-success'}`} />
            {sys.workerBusy ? 'Воркер занят' : 'Воркер свободен'}
          </span>
        </div>
      </header>

      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 pb-16">
        {/* Сводные карточки */}
        <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
          <StatCard
            icon={<ListVideo className="h-[18px] w-[18px]" />}
            tint="bg-primary/12 text-primary dark:bg-primary/22"
            label="В очереди"
            value={String(sys.queueLength)}
            hint={`сегодня задач: ${overview.todayCount}`}
          />
          <StatCard
            icon={<MemoryStick className="h-[18px] w-[18px]" />}
            tint="bg-success/15 text-success dark:bg-success/22"
            label="ОЗУ воркера"
            value={fmtRam(sys.ramUsedMb) ?? '—'}
            hint={`лимит ${fmtRam(sys.ramBudgetMb)} · всего 12 ГБ`}
          >
            <Progress value={Math.min(100, (sys.ramUsedMb / sys.ramTotalMb) * 100)} className="mt-2.5 h-1.5" />
          </StatCard>
          <StatCard
            icon={<Cpu className="h-[18px] w-[18px]" />}
            tint="bg-warning/15 text-warning dark:bg-warning/20"
            label="CPU"
            value={`${sys.cpuPercent}%`}
            hint={`loadavg ${sys.loadavg}`}
          >
            <Progress value={sys.cpuPercent} className="mt-2.5 h-1.5" />
          </StatCard>
          <StatCard
            icon={<Users className="h-[18px] w-[18px]" />}
            tint="bg-[#af52de]/12 text-[#af52de] dark:bg-[#bf5af2]/22"
            label="Пользователи"
            value={String(overview.usersCount)}
            hint={`готово: ${overview.completedCount} · ошибок: ${overview.failedCount}`}
          />
        </div>

        {/* Сегментированный контрол вкладок */}
        <div className="overflow-x-auto scrollbar-thin">
          <Segmented
            value={adminTab}
            onValueChange={setAdminTab}
            options={ADMIN_TABS}
            ariaLabel="Разделы админ-панели"
            className="min-w-[540px]"
          />
        </div>

        {/* ── Очередь + журнал ─────────────────────────────── */}
        {adminTab === 'queue' && (
          <div className="animate-fade-up space-y-4">
            <Card className="gap-0 py-4">
              <CardHeader className="px-4 pb-3">
                <CardTitle className="flex items-center gap-2 text-[14px]">
                  <Gauge className="h-4 w-4 text-primary" />
                  FIFO-очередь рендера
                  <span className="text-[11px] font-normal text-muted-foreground">
                    одновременных рендеров: 1 (защита 12 ГБ ОЗУ)
                  </span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <div className="overflow-x-auto rounded-2xl border border-hairline">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
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
                          <TableCell colSpan={7} className="py-9 text-center text-[13px] text-muted-foreground">
                            Очередь пуста — воркер ждёт задачи
                          </TableCell>
                        </TableRow>
                      )}
                      {overview.jobs.map((job) => (
                        <TableRow key={job.id}>
                          <TableCell className="font-mono text-xs tabular-nums">
                            {job.status === 'processing' ? '▶' : job.queuePosition}
                          </TableCell>
                          <TableCell>
                            <span
                              className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide ${
                                job.type === 'long'
                                  ? 'bg-[#af52de]/12 text-[#af52de] dark:bg-[#bf5af2]/22'
                                  : 'bg-primary/12 text-primary dark:bg-primary/22'
                              }`}
                            >
                              {job.type.toUpperCase()}
                            </span>
                          </TableCell>
                          <TableCell className="max-w-[180px] truncate text-xs">{job.sourceName ?? job.sourceUrl ?? '—'}</TableCell>
                          <TableCell className="hidden text-xs text-muted-foreground md:table-cell">
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
                            <span className="text-[10px] tabular-nums text-muted-foreground">{job.progress}% · {fmtRam(job.ramMb)}</span>
                          </TableCell>
                          <TableCell>
                            {job.status !== 'processing' && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 rounded-full text-muted-foreground hover:text-destructive"
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

            <Card className="gap-0 overflow-hidden py-4">
              <CardHeader className="px-4 pb-3">
                <CardTitle className="flex items-center gap-2 text-[14px]">
                  <PlayCircle className="h-4 w-4 text-primary" />
                  Журнал воркера
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success/50" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
                  </span>
                  <RefreshCw className="h-3.5 w-3.5 text-muted-foreground [animation-duration:3s] animate-spin" />
                </CardTitle>
              </CardHeader>
              <CardContent className="px-4">
                <div
                  ref={logRef}
                  className="scrollbar-thin h-64 overflow-y-auto rounded-2xl border border-white/10 bg-[#0d1017] p-3.5 font-mono text-[11px] leading-relaxed shadow-inner"
                >
                  {events.map((e) => (
                    <p key={e.id} className={e.level === 'error' ? 'text-rose-400' : e.level === 'warn' ? 'text-amber-300' : 'text-slate-300'}>
                      <span className="text-slate-500">[{fmtTime(e.createdAt)}]</span>{' '}
                      <span className="text-slate-500">{e.job ? `${e.job.type.toUpperCase()} · ` : 'SYS · '}</span>
                      {e.message}
                    </p>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* ── Пользователи ─────────────────────────────────── */}
        {adminTab === 'users' && (
          <Card className="animate-fade-up gap-0 py-4">
            <CardHeader className="px-4 pb-3">
              <CardTitle className="text-[14px]">Пользователи и лимиты</CardTitle>
            </CardHeader>
            <CardContent className="px-4">
              <div className="overflow-x-auto rounded-2xl border border-hairline">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
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
        )}

        {/* ── Каналы ───────────────────────────────────────── */}
        {adminTab === 'channels' && (
          <div className="animate-fade-up grid gap-3.5 sm:grid-cols-2">
            {overview.channels.map((ch) => (
              <Card key={ch.id} className="gap-0 py-4">
                <CardContent className="flex items-start gap-3.5 px-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#ff3b30]/10 dark:bg-[#ff453a]/20">
                    <Youtube className="h-5 w-5 text-[#ff3b30] dark:text-[#ff453a]" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold">{ch.channelTitle ?? '—'}</p>
                    <p className="truncate text-[11.5px] text-muted-foreground">
                      {ch.handle} · {ch.channelId}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      профиль движка: profiles/{ch.profileKey}.json
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {ch.status === 'connected' ? (
                      <Badge className="gap-1 bg-success/15 text-success dark:bg-success/22">
                        <CheckCircle2 className="h-3 w-3" /> подключен
                      </Badge>
                    ) : ch.status === 'error' ? (
                      <Badge variant="destructive" className="text-[10px]">ошибка OAuth</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-[10px]">ожидание</Badge>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-[11.5px]"
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
              <p className="text-[13px] text-muted-foreground">
                Каналы ещё не подключены. OAuth-токены хранятся на сервере, см. DEPLOYMENT.md.
              </p>
            )}
          </div>
        )}

        {/* ── Настройки ────────────────────────────────────── */}
        {adminTab === 'settings' && (
          <Card className="animate-fade-up gap-0 py-4">
            <CardHeader className="px-4 pb-3">
              <CardTitle className="text-[14px]">Системные настройки</CardTitle>
            </CardHeader>
            <CardContent className="max-w-md space-y-4 px-4">
              <label className="flex items-center justify-between gap-3 rounded-2xl bg-black/[0.025] px-3.5 py-3 dark:bg-white/[0.04]">
                <span className="text-[13px] font-medium leading-snug">
                  Воркер принимает задачи
                  <span className="block text-[11px] font-normal text-muted-foreground">
                    выключите на время техработ
                  </span>
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
        )}

        {/* ── Менеджер витрины ─────────────────────────────── */}
        {adminTab === 'showcase' && (
          <div className="animate-fade-up">
            <ShowcaseManager items={showcase} reload={loadShowcase} />
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  icon,
  tint,
  label,
  value,
  hint,
  children,
}: {
  icon: React.ReactNode;
  tint: string;
  label: string;
  value: string;
  hint?: string;
  children?: React.ReactNode;
}) {
  return (
    <Card className="gap-0 py-4">
      <CardContent className="px-4">
        <div className="flex items-center gap-2.5">
          <span className={`flex h-8 w-8 items-center justify-center rounded-xl ${tint}`}>{icon}</span>
          <span className="text-[12px] font-medium text-muted-foreground">{label}</span>
        </div>
        <p className="mt-2 text-[26px] font-bold leading-none tabular-nums tracking-tight">{value}</p>
        {children}
        {hint && <p className="mt-1.5 text-[10.5px] leading-snug text-muted-foreground">{hint}</p>}
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
      <p className="px-1 text-[12px] text-muted-foreground">{label}</p>
      <div className="flex gap-2">
        <Input value={v} onChange={(e) => setV(e.target.value)} inputMode="numeric" className="tabular-nums" />
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
        <p className="truncate text-[13px] font-semibold">{u.firstName ?? '—'}</p>
        <p className="text-[11px] text-muted-foreground">@{u.username ?? u.telegramId} · {u.dailyUsed}/{u.dailyLimit} сегодня</p>
      </TableCell>
      <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{u.telegramId}</TableCell>
      <TableCell>
        <Select value={u.role} onValueChange={(role) => patch({ role })}>
          <SelectTrigger className="h-8 rounded-full text-xs" aria-label="Роль"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="user">user</SelectItem>
            <SelectItem value="admin">admin</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <Input value={limit} onChange={(e) => setLimit(e.target.value)} className="h-8 w-14 rounded-full text-xs tabular-nums" inputMode="numeric" aria-label="Лимит в день" />
          <Button size="sm" variant="ghost" className="h-8 w-8 rounded-full px-0" disabled={limit === String(u.dailyLimit)} onClick={() => patch({ dailyLimit: Number(limit) })} aria-label="Применить лимит">
            ✓
          </Button>
        </div>
      </TableCell>
      <TableCell className="hidden text-xs tabular-nums text-muted-foreground md:table-cell">{u._count.jobs}</TableCell>
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
      <Card className="gap-0 py-4">
        <CardHeader className="px-4 pb-3">
          <CardTitle className="flex items-center gap-2 text-[14px]">
            Работы в витрине
            <span className="rounded-full bg-primary/12 px-2 py-0.5 text-[11px] font-bold tabular-nums text-primary dark:bg-primary/20">
              {items.length}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 px-4">
          {items.map((it) => (
            <div key={it.id} className="flex items-center gap-3 rounded-2xl border border-hairline p-2.5">
              <div
                className="h-12 w-9 shrink-0 rounded-xl bg-muted bg-cover bg-center ring-1 ring-black/5 dark:ring-white/10"
                style={{ backgroundImage: `url('${it.thumbUrl}')` }}
                role="img"
                aria-label="Обложка работы"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12.5px] font-semibold">{it.title}</p>
                <p className="text-[10.5px] text-muted-foreground">{it.kind.toUpperCase()} · {it.views} просм. · /{it.thumbUrl.split('/').pop()}</p>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className={`h-8 w-8 rounded-full p-0 ${it.featured ? 'text-amber-500' : 'text-muted-foreground'}`}
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
                className="h-8 w-8 rounded-full p-0 text-muted-foreground hover:text-destructive"
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

      <Card className="gap-0 py-4">
        <CardHeader className="px-4 pb-3">
          <CardTitle className="text-[14px]">Добавить работу</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 px-4">
          <Select value={form.kind} onValueChange={(kind) => setForm((f) => ({ ...f, kind }))}>
            <SelectTrigger aria-label="Тип работы" className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="short">Short (вертикальное)</SelectItem>
              <SelectItem value="long">Long (1280×720)</SelectItem>
            </SelectContent>
          </Select>
          <Input value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} placeholder="Заголовок" />
          <Input value={form.subtitle} onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))} placeholder="Подзаголовок" />
          <Select value={form.thumbUrl} onValueChange={(thumbUrl) => setForm((f) => ({ ...f, thumbUrl }))}>
            <SelectTrigger aria-label="Обложка" className="w-full"><SelectValue /></SelectTrigger>
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
