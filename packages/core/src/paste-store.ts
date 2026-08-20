// Process-wide paste store: the single PasteStore instance every surface
// shares, over the implementation in ./signals/paste-store.ts.
export { PASTE_MAX_AGE, PasteStore } from './signals/paste-store.js';
export type { PasteStoreResult } from './signals/paste-store.js';

import { PasteStore } from './signals/paste-store.js';
export const pasteStore = new PasteStore();
