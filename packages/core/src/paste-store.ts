// Facade over ./generated/signals/paste-store.js — edit the source there.
export { PASTE_MAX_AGE, PasteStore } from './signals/paste-store.js';
export type { PasteStoreResult } from './signals/paste-store.js';

import { PasteStore } from './signals/paste-store.js';
export const pasteStore = new PasteStore();
