'use client';

import { Clapperboard, Hourglass, LayoutGrid, ListChecks, Scissors } from 'lucide-react';
import type { Job, ShowcaseItem, User } from '@/lib/types';
import type { Tab } from '@/components/app-root';
import { ShortsTab } from '@/components/miniapp/shorts-tab';
import { LongTab } from '@/components/miniapp/long-tab';
import { ShowcaseTab } from '@/components/miniapp/showcase-tab';
import { TasksTab } from '@/components/miniapp/tasks-tab';

const TABS: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { key: 'shorts', label: 'Shorts', icon: Scissors },
  { key: 'long', label: 'Long', icon: Hourglass },
  { key: 'showcase', label: 'Витрина', icon: LayoutGrid },
  { key: 'tasks', label: 'Задачи', icon: ListChecks },
];

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
  const activeJobs = jobs.filter((j) => j.status === 'queued' || j.status === 'processing');
  const badge = activeJobs.length;

  return (
    <>
      <div className="px-4 pt-4">
        {tab === 'shorts' && <ShortsTab user={user} onCreated={onJobCreated} />}
        {tab === 'long' && <LongTab user={user} onCreated={onJobCreated} />}
        {tab === 'showcase' && <ShowcaseTab items={showcase} reload={reloadShowcase} />}
        {tab === 'tasks' && <TasksTab jobs={jobs} />}
      </div>

      {/* Нижняя навигация в стиле Telegram */}
      <nav
        className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-md z-40 border-t border-border bg-card/95 backdrop-blur-md pb-safe"
        aria-label="Основная навигация"
      >
        <div className="grid grid-cols-4">
          {TABS.map(({ key, label, icon: Icon }) => {
            const isActive = tab === key;
            return (
              <button
                key={key}
                onClick={() => onTabChange(key)}
                aria-current={isActive ? 'page' : undefined}
                className={`relative flex flex-col items-center gap-1 py-2.5 text-[11px] font-medium transition-colors min-h-[52px] justify-center ${
                  isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                <span className="relative">
                  <Icon className="h-5 w-5" />
                  {key === 'tasks' && badge > 0 && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[16px] h-4 px-1 rounded-full bg-primary text-primary-foreground text-[10px] leading-4 text-center">
                      {badge}
                    </span>
                  )}
                </span>
                {label}
                {isActive && <span className="absolute top-0 left-1/2 -translate-x-1/2 h-0.5 w-8 rounded-full bg-primary" />}
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
