// Process-wide file-state cache over ./blocks/file-state-cache.ts.
// Singleton: all tools MUST share this instance for read-before-write to work.
import { FileStateCache } from './blocks/file-state-cache.js';
export { FileStateCache, getProjectFileStateCache, clearProjectFileStateCaches } from './blocks/file-state-cache.js';
export const fileStateCache = new FileStateCache();
