// Facade over ./generated/types.js — edit the source there.
export * from './types-impl.js';

// ForgeEventCallback — KERN's type node can't express function types
// (it creates string literal unions). This is the one manual type.
import type { ForgeEvent } from '@kernlang/agon-core';
export type ForgeEventCallback = (event: ForgeEvent) => void;
