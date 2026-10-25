'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChefHat, Film, Gauge, HelpCircle, LogOut, Maximize, Minimize, ShieldCheck } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { api } from '@/lib/client-api';
import {
  getTg,
  hapticTap,
  onFullscreenChange,
  requestAutoFullscreen,
  tgInitData,
  toggleFullscreen,
} from '@/lib/telegram-client';
import { LANGS, LanguageProvider, useI18n, type Lang } from '@/lib/i18n';
import type { Job, ShowcaseItem, User } from '@/lib/types';
import { MiniApp } from '@/components/miniapp/mini-app';
import { DynamicIsland } from '@/components/miniapp/dynamic-island';
import { ModesExplainerModal } from '@/components/miniapp/modes-explainer-modal';
import { AdminPanel } from '@/components/admin/admin-panel';
import { Button } from '@/components/ui/button';

type View = 'mini' | 'admin';
export type Tab = 'hooks' | 'shorts' | 'long' | 'showcase' | 'tasks';

/** Компактный переключатель языка 🌐 RU | UA — мгновенно, без перезагрузки. */
function LangSwitcher() {
  const { lang, setLang } = useI18n();
  const pick = (l: Lang) => {
    if (l !== lang) {
      hapticTap();
      setLang(l);
    }
  };
  return (
    <div
      className="flex h-9 shrink-0 items-center gap-0.5 rounded-full bg-black/[0.04] p-0.5 dark:bg-white/[0.08]"
      role="group"
      aria-label="Мова інтерфейсу / Язык интерфейса"
    >
      <span aria-hidden className="hidden pl-1.5 pr-0.5 text-[11px] leading-none text-muted-foreground sm:inline">
        🌐
      </span>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => pick(l)}
          aria-pressed={lang === l}
          className={`h-8 rounded-full px-2 text-[10.5px] font-bold uppercase tracking-wide transition-all duration-200 active:scale-90 sm:px-2.5 sm:text-[11px] ${
            lang === l
              ? 'bg-white text-primary shadow-sm dark:bg-white/15'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function AppRootInner() {
  const { t } = useI18n();
  const [user, setUser] = useState<User | null>(null);
  const [authDone, setAuthDone] = useState(false);
  const [view, setView] = useState<View>('mini');
  // Client Mode открывается на главной фиче для блогеров — ИИ-хуки (Opus Clip style)
  const [tab, setTab] = useState<Tab>('hooks');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [showcase, setShowcase] = useState<ShowcaseItem[]>([]);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const bannerRef = useRef(false);
  // ℹ️ Шпаргалка «Как работают 3 режима» — из любой вкладки (отзыв владельца о путанице)
  const [modesOpen, setModesOpen] = useState(false);

  // ── Авторизация: Telegram initData либо демо-вход ──────────
  const authenticate = useCallback(async () => {
    try {
      const initData = tgInitData();
      const { user: u } = await api<{ user: User }>('/api/auth', {
        method: 'POST',
        body: JSON.stringify({ initData: initData ?? undefined }),
      });
      setUser(u);
    } catch {
      try {
        const { user: u } = await api<{ user: User }>('/api/auth');
        setUser(u);
      } catch {
        setUser(null);
      }
    } finally {
      setAuthDone(true);
    }
  }, []);

  // ── Старт WebApp: expand + авто-fullscreen на всех платформах ──
  useEffect(() => {
    const tg = getTg();
    tg?.ready();
    tg?.expand();
    tg?.disableVerticalSwipes?.();
    // Полноэкранный режим (Bot API 8.0+): мобильные и Telegram Desktop.
    // Вне Telegram метода нет — requestAutoFullscreen просто ничего не делает.
    requestAutoFullscreen();
    authenticate();
  }, [authenticate]);

  // ── Синхронизация состояния fullscreen (Telegram-события + браузерный API) ──
  useEffect(() => {
    setIsFullscreen(Boolean(getTg()?.isFullscreen));
    return onFullscreenChange(setIsFullscreen);
  }, []);

  const handleToggleFullscreen = () => {
    hapticTap();
    void toggleFullscreen();
  };

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
    const timer = setInterval(poll, 2000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [user]);

  const switchTab = (tabNext: Tab) => {
    hapticTap();
    setTab(tabNext);
  };

  const logout = async () => {
    await api('/api/auth', { method: 'DELETE' }).catch(() => undefined);
    setUser(null);
    setAuthDone(false);
    bannerRef.current = false;
    await authenticate();
    toast({ title: t.header.sessionResetTitle, description: t.header.sessionResetDesc });
  };

  const hasActiveJobs = jobs.some((j) => j.status === 'queued' || j.status === 'processing');

  // Боевой статус владельца: «Сергей (владелец) • Pro 2026»
  const ownerName = (user?.firstName ?? 'Сергей').replace(/\s*\([^)]*\)/g, '').trim() || 'Сергей';
  const statusLine = `${ownerName}${user?.role === 'admin' ? ` ${t.header.ownerRole}` : ''} • ${t.header.statusSuffix}`;

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
            <p className="text-sm font-medium text-muted-foreground">{t.header.connecting}</p>
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
              <h1 className="text-xl font-bold tracking-tight">{t.brand}</h1>
              <p className="text-[13px] leading-relaxed text-muted-foreground">{t.header.loginDesc}</p>
            </div>
            <Button size="lg" className="w-full" onClick={authenticate}>
              {t.header.loginBtn}
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
      <div className="flex justify-center">
        <div className="relative w-full max-w-md min-h-screen flex flex-col shadow-float sm:border-x hairline md:max-w-6xl">
          {/* Aurora-свечение в верхней части колонки */}
          <div className="absolute inset-x-0 top-0 h-96 overflow-hidden pointer-events-none" aria-hidden>
            <div className="aurora" />
          </div>

          {/* Шапка iOS: стеклянная, липкая, с Dynamic Island.
              pt-safe: на смартфонах в fullscreen кнопки шапки не перекрываются
              системной шторкой и вырезом камеры (env(safe-area-inset-top)). */}
          <header className="sticky top-0 z-40">
            <div className="glass-strong border-b hairline pt-safe">
              {hasActiveJobs && (
                <div className="px-3 pt-3">
                  <DynamicIsland jobs={jobs} onOpen={() => switchTab('tasks')} />
                </div>
              )}
              <div className="flex min-h-[64px] items-center gap-1.5 px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[13px] bg-gradient-to-b from-[#3a9bff] to-[#0063e0] shadow-glow dark:from-[#0a84ff] dark:to-[#0058c8] dark:shadow-glow-dark">
                  <ChefHat className="h-5 w-5 text-white" />
                </div>
                <div className="min-w-0 flex-1">
                  <h1 className="truncate text-[15px] font-bold leading-tight tracking-tight sm:text-[17px]">
                    {t.brand}
                  </h1>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {/* На узких экранах — короткий статус, на десктопе — полный */}
                    <span className="md:hidden">
                      {ownerName} • {t.header.statusSuffix}
                    </span>
                    <span className="hidden md:inline">{statusLine}</span>
                  </p>
                </div>
                <span
                  className="flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 text-[12px] font-semibold tabular-nums text-primary sm:px-3 dark:bg-primary/20"
                  title={t.header.balanceTitle(user.dailyUsed, user.dailyLimit)}
                >
                  <Gauge className="h-3.5 w-3.5" />
                  {user.dailyUsed}/{user.dailyLimit}
                </span>
                {/* Переключатель режима окна: ⛶ развернуть / ❐ свернуть */}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={isFullscreen ? t.header.exitFs : t.header.expand}
                  title={isFullscreen ? t.header.exitFs : t.header.expand}
                  className="h-9 w-9 shrink-0 rounded-full bg-black/[0.04] text-muted-foreground hover:bg-primary/10 hover:text-primary dark:bg-white/[0.08] dark:hover:bg-white/[0.14]"
                  onClick={handleToggleFullscreen}
                >
                  {isFullscreen ? <Minimize className="h-4.5 w-4.5" /> : <Maximize className="h-4.5 w-4.5" />}
                </Button>
                {/* ℹ️ Шпаргалка «Как работают 3 режима» — рядом с языком, в любой момент */}
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t.header.modesHint}
                  title={t.header.modesHint}
                  className="h-9 w-9 shrink-0 rounded-full bg-black/[0.04] text-muted-foreground hover:bg-primary/10 hover:text-primary dark:bg-white/[0.08] dark:hover:bg-white/[0.14]"
                  onClick={() => {
                    hapticTap();
                    setModesOpen(true);
                  }}
                >
                  <HelpCircle className="h-4.5 w-4.5" />
                </Button>
                <LangSwitcher />
                {user.role === 'admin' && (
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={t.header.admin}
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
                  aria-label={t.header.logout}
                  className="hidden h-9 w-9 shrink-0 rounded-full bg-black/[0.04] text-muted-foreground hover:bg-black/[0.08] hover:text-destructive sm:inline-flex dark:bg-white/[0.08] dark:hover:bg-white/[0.14]"
                  onClick={logout}
                >
                  <LogOut className="h-4.5 w-4.5" />
                </Button>
              </div>
            </div>
          </header>

          <main className="relative flex-1 pb-32 md:pb-12">
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

      {/* ℹ️ Шпаргалка: как работают 3 режима — вызывается из шапки */}
      <ModesExplainerModal open={modesOpen} onOpenChange={setModesOpen} />
    </div>
  );
}

export function AppRoot() {
  return (
    <LanguageProvider>
      <AppRootInner />
    </LanguageProvider>
  );
}
