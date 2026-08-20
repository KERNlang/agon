// Facade over ./generated/blocks/file-state-cache.js — edit the source there.
// Singleton facade: all tools MUST share this instance for read-before-write to work.
import { FileStateCache } from './generated/blocks/file-state-cache.js';
export { FileStateCache, getProjectFileStateCache, clearProjectFileStateCaches } from './generated/blocks/file-state-cache.js';
export const fileStateCache = new FileStateCache();
