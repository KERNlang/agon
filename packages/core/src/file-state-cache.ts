// ── File State Cache — KERN-sourced ──────────────────────────────
// Singleton facade: all tools MUST share this instance for read-before-write to work.
import { FileStateCache } from './generated/file-state-cache.js';
export { FileStateCache };
export const fileStateCache = new FileStateCache();
