// ── Paste Store — KERN-sourced ──────────────────────────────────────
// Source of truth: src/kern/paste-store.kern
export { PASTE_THRESHOLD, PASTE_MAX_AGE, PasteStore } from './generated/paste-store.js';
export type { PasteStoreResult } from './generated/paste-store.js';

import { PasteStore } from './generated/paste-store.js';
export const pasteStore = new PasteStore();
