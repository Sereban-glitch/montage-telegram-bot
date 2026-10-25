'use client';

import { Crosshair, Hourglass, LayoutGrid, ListChecks, Scissors } from 'lucide-react';
import type { Job, ShowcaseItem, User } from '@/lib/types';
import type { Tab } from '@/components/app-root';
import { useI18n } from '@/lib/i18n';
import { Segmented } from '@/components/ui/segmented';
import { HooksTab } from '@/components/miniapp/hooks-tab';
import { ShortsTab } from '@/components/miniapp/shorts-tab';
import { LongTab } from '@/components/miniapp/long-tab';
import { ShowcaseTab } from '@/components/miniapp/showcase-tab';
import { TasksTab } from '@/components/miniapp/tasks-tab';

// Client Mode: функции монтажа для друзей — админ-инструменты живут отдельно
// (кнопка щита в шапке → AdminPanel: Domdara Hub / Очередь / YouTube)

export function MiniApp({
  user,
  tab,
  jobs,
  showcase,
  onTabChange,
  onJobCreated,
  reloadShowcase,
}: {
  user: User;
  tab: Tab;
  jobs: Job[];
  showcase: ShowcaseItem[];
  onTabChange: (t: Tab) => void;
  onJobCreated: () => void;
  reloadShowcase: () => void;
}) {
  const { t } = useI18n();
  const activeJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'processing');
  const badge = activeJobs.length;

  // Короткие метки — мобильный таб-бар; длинные («Витрина работ», «Мои задачи») — десктопный Segmented
  const TABS: {
    key: Tab;
    label: string;
    labelLong: string;
    icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  }[] = [
    { key: 'hooks', label: t.tabs.hooks, labelLong: t.tabs.hooksLong, icon: Crosshair },
    { key: 'shorts', label: t.tabs.shorts, labelLong: t.tabs.shorts, icon: Scissors },
    { key: 'long', label: t.tabs.long, labelLong: t.tabs.long, icon: Hourglass },
    { key: 'showcase', label: t.tabs.showcase, labelLong: t.tabs.showcaseLong, icon: LayoutGrid },
    { key: 'tasks', label: t.tabs.tasks, labelLong: t.tabs.tasksLong, icon: ListChecks },
  ];

  return (
    <>
      {/* Desktop-навигация (Telegram Desktop / окно ≥ 768px): iOS Segmented Control */}
      <nav className="hidden justify-center px-6 pb-1 pt-2 md:flex" aria-label={t.tabs.sectionsAria}>
        <Segmented
          value={tab}
          onValueChange={onTabChange}
          ariaLabel={t.tabs.sectionsAria}
          className="w-full max-w-xl"
          options={TABS.map(({ key, labelLong, icon: Icon }) => ({
            value: key,
            label: (
              <span className="relative flex items-center gap-1.5">
                <Icon className="h-4 w-4" strokeWidth={tab === key ? 2.2 : 1.9} />
                {labelLong}
                {key === 'tasks' && badge > 0 && (
                  <span className="absolute -top-2 -right-3.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff3b30] px-1 text-[9.5px] font-bold leading-none text-white shadow-sm">
                    {badge}
                  </span>
                )}
              </span>
            ),
          }))}
        />
      </nav>

      <div
        key={tab}
        className={`animate-fade-up px-4 pt-4 md:px-6 md:pt-5 ${
          tab === 'shorts' || tab === 'hooks' ? '' : 'md:mx-auto md:max-w-2xl'
        }`}
      >
        {tab === 'hooks' && <HooksTab user={user} jobs={jobs} />}
        {tab === 'shorts' && <ShortsTab user={user} onCreated={onJobCreated} />}
        {tab === 'long' && <LongTab user={user} onCreated={onJobCreated} />}
        {tab === 'showcase' && <ShowcaseTab items={showcase} reload={reloadShowcase} />}
        {tab === 'tasks' && <TasksTab jobs={jobs} />}
      </div>

      {/* Нижняя навигация iOS: парящее матовое стекло — только мобильные (< 768px) */}
      <nav
        className="glass-strong fixed bottom-0 left-1/2 z-40 w-full max-w-md -translate-x-1/2 pb-safe md:hidden"
        aria-label={t.tabs.navAria}
      >
        <div className="grid grid-cols-5 px-1 pt-1.5">
          {TABS.map(({ key, label, icon: Icon }) => {
            const isActive = tab === key;
            return (
              <button
                key={key}
                onClick={() => onTabChange(key)}
                aria-current={isActive ? 'page' : undefined}
                className={`tap-none relative flex min-h-[54px] flex-col items-center justify-center gap-0.5 py-1.5 text-[10px] font-medium transition-all duration-200 active:scale-90 ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                <span className="relative">
                  <Icon className="h-[22px] w-[22px]" strokeWidth={isActive ? 2.2 : 1.9} />
                  {key === 'tasks' && badge > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#ff3b30] px-1 text-[9.5px] font-bold leading-none text-white shadow-sm">
                      {badge}
                    </span>
                  )}
                </span>
                {label}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
