// Public forge type surface over ./types-impl.ts, adding the one function
// type (ForgeEventCallback) the shape declarations cannot express.
export * from './types-impl.js';

// ForgeEventCallback — KERN's type node can't express function types
// (it creates string literal unions). This is the one manual type.
import type { ForgeEvent } from '@kernlang/agon-core';
export type ForgeEventCallback = (event: ForgeEvent) => void;
