'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChefHat, ShieldCheck, LogOut, Film } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api } from '@/lib/client-api';
import { getTg, tgInitData, hapticTap } from '@/lib/telegram-client';
import type { Job, ShowcaseItem, User } from '@/lib/types';
import { MiniApp } from '@/components/miniapp/mini-app';
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

  if (!authDone) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-4 text-muted-foreground">
          <ChefHat className="h-10 w-10 animate-pulse text-primary" />
          <p className="text-sm">Подключаемся к кухне монтажа…</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-6">
        <div className="max-w-sm w-full text-center space-y-4">
          <div className="mx-auto h-16 w-16 rounded-2xl bg-primary/15 flex items-center justify-center">
            <Film className="h-8 w-8 text-primary" />
          </div>
          <h1 className="text-xl font-bold">Монтажная Кухня</h1>
          <p className="text-sm text-muted-foreground">
            Не удалось войти автоматически. Откройте приложение через Telegram-бота или повторите демо-вход.
          </p>
          <Button onClick={authenticate} className="w-full">Войти</Button>
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
      {demoMode && (
        <div className="bg-amber-500/15 text-amber-600 dark:text-amber-400 text-center text-xs py-1.5 px-3 border-b border-amber-500/20">
          Демо-режим песочницы — откройте приложение через бота в Telegram для полного цикла
        </div>
      )}
      <div className="flex justify-center">
        <div className="w-full max-w-md min-h-screen flex flex-col relative shadow-2xl sm:border-x border-border">
          {/* Шапка */}
          <header className="sticky top-0 z-30 bg-card/85 backdrop-blur-md border-b border-border">
            <div className="flex items-center gap-3 px-4 py-3">
              <div className="h-10 w-10 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
                <ChefHat className="h-5.5 w-5.5 text-primary" />
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="font-bold leading-tight truncate">Монтажная Кухня</h1>
                <p className="text-[11px] text-muted-foreground truncate">
                  Движок Sereban-glitch-video-montage v2.0.0
                </p>
              </div>
              {user.role === 'admin' && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Админ-панель"
                  className="h-9 w-9 shrink-0 text-muted-foreground hover:text-primary"
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
                className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                onClick={logout}
              >
                <LogOut className="h-4.5 w-4.5" />
              </Button>
            </div>
          </header>

          <main className="flex-1 pb-28">
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
