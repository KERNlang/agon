import { AsyncLocalStorage } from 'node:async_hooks';

export interface JobAbortStore {
  signal: AbortSignal;
  child: AbortController|null;
  detach: (()=>void)|null;
}

export const jobAbortStorage: AsyncLocalStorage<JobAbortStore> = new AsyncLocalStorage<JobAbortStore>();

export async function runInJobAbortScope(signal: AbortSignal, fn: ()=>Promise<void>): Promise<void> {
  const store: JobAbortStore = { signal, child: null, detach: null };
  try {
    await jobAbortStorage.run(store, fn);
  } finally {
    store.detach?.();
    store.detach = null;
    store.child = null;
  }
}

export function trackJobAbortController(child: AbortController|null): boolean {
  const store = jobAbortStorage.getStore();
  if (!store) return false;
  store.detach?.();
  store.detach = null;
  store.child = child;
  if (!child) return true;
  const forward = () => {
    if (!child.signal.aborted) child.abort(store.signal.reason);
  };
  if (store.signal.aborted) {
    forward();
  } else {
    store.signal.addEventListener('abort', forward, { once: true });
    store.detach = () => store.signal.removeEventListener('abort', forward);
  }
  return true;
}
