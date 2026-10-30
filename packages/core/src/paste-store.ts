// Process-wide paste store: the single PasteStore instance every surface
// shares, over the persistence package implementation.
export { PASTE_MAX_AGE, PasteStore } from '@kernlang/agon-support-persistence';
export type { PasteStoreResult } from '@kernlang/agon-support-persistence';

import { PasteStore } from '@kernlang/agon-support-persistence';
export const pasteStore = new PasteStore();
