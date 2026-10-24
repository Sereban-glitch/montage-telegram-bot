import { ensureSeed } from '@/lib/seed';
import { ensureWorkerStarted } from '@/lib/virtual-worker';

const g = globalThis as unknown as { __mkBooted?: boolean };

// Единая точка инициализации демо-контура (идемпотентна)
export async function boot() {
  if (!g.__mkBooted) {
    await ensureSeed();
    await ensureWorkerStarted();
    g.__mkBooted = true;
  }
}
