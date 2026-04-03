import { scanProjectContext } from './context-scanner.js';

export class SessionContext {
  private cache: string|null = null;
  private cachedCwd: string|null = null;
  private cachedExtra: string|null = null;
  private capturedAt: number|null = null;

  get(cwd: string, extra?: string): string {
    const extraVal = extra ?? null;
    if (this.cache !== null && this.cachedCwd === cwd && this.cachedExtra === extraVal) {
      return this.cache;
    }
    this.cache = scanProjectContext(cwd, extra);
    this.cachedCwd = cwd;
    this.cachedExtra = extraVal;
    this.capturedAt = Date.now();
    return this.cache;
  }

  invalidate(): void {
    this.cache = null;
    this.cachedCwd = null;
    this.cachedExtra = null;
    this.capturedAt = null;
  }

  age(): number {
    if (this.capturedAt === null) return Infinity;
    return Date.now() - this.capturedAt;
  }

  isStale(maxAgeMs?: number): boolean {
    const limit = maxAgeMs ?? 300_000;
    return this.age() > limit;
  }
}

export const sessionContext = new SessionContext();

