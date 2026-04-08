// ── Paste Store — KERN-sourced ──────────────────────────────────────
// Source of truth: src/kern/paste-store.kern
export { PASTE_MAX_AGE, PasteStore } from './generated/signals/paste-store.js';
export type { PasteStoreResult } from './generated/signals/paste-store.js';

import { PasteStore } from './generated/signals/paste-store.js';
export const pasteStore = new PasteStore();
