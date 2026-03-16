// ── Re-export from KERN-generated types ─────────────────────────────
// Source of truth: src/kern/types.kern
export * from './generated/types.js';

// ForgeEventCallback — KERN's type node can't express function types
// (it creates string literal unions). This is the one manual type.
import type { ForgeEvent } from '@agon/core';
export type ForgeEventCallback = (event: ForgeEvent) => void;
