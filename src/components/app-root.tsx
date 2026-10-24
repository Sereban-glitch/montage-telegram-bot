'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChefHat, Film, Info, LogOut, ShieldCheck } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api } from '@/lib/client-api';
import { getTg, tgInitData, hapticTap } from '@/lib/telegram-client';
import type { Job, ShowcaseItem, User } from '@/lib/types';
import { MiniApp } from '@/components/miniapp/mini-app';
import { DynamicIsland } from '@/components/miniapp/dynamic-island';
import { AdminPanel } from '@/components/admin/admin-panel';
import { Button } from '@/components/ui/button';

type View = 'mini' | 'admin';
export type Tab = 'shorts' | 'long' | 'showcase' | 'tasks';

export function AppRoot() {
  const [user, setUser] = useState<User | null>(null);
  const [authDone, setAuthDone] = useState(false);
  const [demoMode, setDemoMode] = useState(true);
  const [view, setView] = useState<View>('mini');
  const [tab, setTab] = useState<Tab>('shorts');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [showcase, setShowcase] = useState<ShowcaseItem[]>([]);
  const bannerRef = useRef(false);

  // ── Авторизация: Telegram initData либо демо-вход ──────────
  const authenticate = useCallback(async () => {
    try {
      const initData = tgInitData();
      const { user: u } = await api<{ user: User }>('/api/auth', {
        method: 'POST',
        body: JSON.stringify({ initData: initData ?? undefined }),
      });
      setUser(u);
      setDemoMode(!initData);
    } catch {
      try {
        const { user: u } = await api<{ user: User }>('/api/auth');
        setUser(u);
        setDemoMode(true);
      } catch {
        setUser(null);
      }
    } finally {
      setAuthDone(true);
    }
  }, []);

  useEffect(() => {
    const tg = getTg();
    tg?.ready();
    tg?.expand();
    try {
      tg?.requestFullscreen?.();
    } catch {
      /* ignore */
    }
    tg?.disableVerticalSwipes?.();
    authenticate();
  }, [authenticate]);

  // ── Витрина (грузится один раз) ────────────────────────────
  const loadShowcase = useCallback(async () => {
    try {
      const { items } = await api<{ items: ShowcaseItem[] }>('/api/showcase');
      setShowcase(items);
    } catch {
      /* тихо */
    }
  }, []);

  useEffect(() => {
    if (authDone && !bannerRef.current) {
      bannerRef.current = true;
      loadShowcase();
    }
  }, [authDone, loadShowcase]);

  // ── Поллинг задач каждые 2 с ───────────────────────────────
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const poll = async () => {
      if (document.hidden) return;
      try {
        const { jobs: j } = await api<{ jobs: Job[] }>('/api/jobs');
        if (alive) setJobs(j);
      } catch {
        /* сеть моргнула — не страшно */
      }
    };
    poll();
    const t = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [user]);

  const switchTab = (t: Tab) => {
    hapticTap();
    setTab(t);
  };

  const logout = async () => {
    await api('/api/auth', { method: 'DELETE' }).catch(() => undefined);
    setUser(null);
    setAuthDone(false);
    bannerRef.current = false;
    await authenticate();
    toast({ title: 'Сессия сброшена', description: 'Вход выполнен заново' });
  };

  const hasActiveJobs = jobs.some((j) => j.status === 'queued' || j.status === 'processing');

  if (!authDone) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-background">
        <div className="absolute inset-x-0 top-0 h-96 overflow-hidden" aria-hidden>
          <div className="aurora" />
        </div>
        <div className="relative flex min-h-screen items-center justify-center">
          <div className="flex flex-col items-center gap-5">
            <div className="flex h-[76px] w-[76px] animate-pulse items-center justify-center rounded-[24px] bg-gradient-to-b from-[#3a9bff] to-[#0063e0] shadow-glow dark:from-[#0a84ff] dark:to-[#0058c8] dark:shadow-glow-dark">
              <ChefHat className="h-9 w-9 text-white" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">Подключаемся к кухне монтажа…</p>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-background">
        <div className="absolute inset-x-0 top-0 h-96 overflow-hidden" aria-hidden>
          <div className="aurora" />
        </div>
        <div className="relative flex min-h-screen items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-5 rounded-3xl border border-hairline bg-card p-7 text-center shadow-soft">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[20px] bg-gradient-to-b from-[#3a9bff] to-[#0063e0] shadow-glow dark:from-[#0a84ff] dark:to-[#0058c8] dark:shadow-glow-dark">
              <Film className="h-8 w-8 text-white" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-xl font-bold tracking-tight">Монтажная Кухня</h1>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                Не удалось войти автоматически. Откройте приложение через Telegram-бота или повторите демо-вход.
              </p>
            </div>
            <Button size="lg" className="w-full" onClick={authenticate}>
              Войти
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'admin') {
    return (
      <AdminPanel
        user={user}
        onBack={() => {
          hapticTap();
          setView('mini');
        }}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <div className="flex justify-center w-full">
        <div className="relative w-full max-w-md md:max-w-6xl min-h-screen flex flex-col shadow-float sm:border-x hairline transition-all">
          {/* Aurora-свечение в верхней части колонки */}
          <div className="absolute inset-x-0 top-0 h-96 overflow-hidden pointer-events-none" aria-hidden>
            <div className="aurora" />
          </div>

          {/* Шапка iOS: стеклянная, липкая, с Dynamic Island и десктоп-навигацией */}
          <header className="sticky top-0 z-40">
            <div className="glass-strong border-b hairline">
              {hasActiveJobs && (
                <div className="px-3 pt-3">
                  <DynamicIsland jobs={jobs} onOpen={() => switchTab('tasks')} />
                </div>
              )}
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-b from-[#3a9bff] to-[#0063e0] shadow-glow dark:from-[#0a84ff] dark:to-[#0058c8] dark:shadow-glow-dark">
                  <ChefHat className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h1 className="truncate text-[17px] font-bold leading-tight tracking-tight">Монтажная Кухня</h1>
                    <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[10.5px] font-semibold bg-primary/12 text-primary border border-primary/20">
                      Сергей (владелец) • Pro 2026
                    </span>
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">
                    Sereban-glitch-video-montage v2.0.0
                  </p>
                </div>

                {/* Навигация для десктопа */}
                <div className="hidden md:flex items-center gap-1 bg-black/[0.04] dark:bg-white/[0.06] p-1 rounded-full border hairline">
                  <button
                    onClick={() => switchTab('shorts')}
                    className={`px-3 py-1 text-xs font-semibold rounded-full transition-all ${
                      tab === 'shorts' ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Shorts (9:16)
                  </button>
                  <button
                    onClick={() => switchTab('long')}
                    className={`px-3 py-1 text-xs font-semibold rounded-full transition-all ${
                      tab === 'long' ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Long (16:9)
                  </button>
                  <button
                    onClick={() => switchTab('showcase')}
                    className={`px-3 py-1 text-xs font-semibold rounded-full transition-all ${
                      tab === 'showcase' ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Витрина
                  </button>
                  <button
                    onClick={() => switchTab('tasks')}
                    className={`px-3 py-1 text-xs font-semibold rounded-full transition-all ${
                      tab === 'tasks' ? 'bg-primary text-white shadow-sm' : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    Задачи ({jobs.length})
                  </button>
                </div>

                {user.role === 'admin' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label="Админ-панель"
                    className="h-9 w-9 shrink-0 rounded-full bg-black/[0.04] text-muted-foreground hover:bg-black/[0.08] hover:text-primary dark:bg-white/[0.08] dark:hover:bg-white/[0.14]"
                    onClick={() => {
                      hapticTap();
                      setView('admin');
                    }}
                  >
                    <ShieldCheck className="h-5 w-5" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Сбросить сессию"
                  className="h-9 w-9 shrink-0 rounded-full bg-black/[0.04] text-muted-foreground hover:bg-black/[0.08] hover:text-destructive dark:bg-white/[0.08] dark:hover:bg-white/[0.14]"
                  onClick={logout}
                >
                  <LogOut className="h-4.5 w-4.5" />
                </Button>
              </div>
            </div>
          </header>

          <main className="relative flex-1 pb-32">
            <MiniApp
              user={user}
              tab={tab}
              jobs={jobs}
              showcase={showcase}
              onTabChange={switchTab}
              onJobCreated={() => switchTab('tasks')}
              reloadShowcase={loadShowcase}
            />
          </main>
        </div>
      </div>
    </div>
  );
}
