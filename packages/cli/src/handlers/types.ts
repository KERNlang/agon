// ── Handler types — KERN-sourced ─────────────────────────────────────
// Source of truth: kern/handler-types.kern → generated/handler-types.ts
// This facade adds: Dispatch type alias (KERN type node can't generate function aliases)
//                   readonly on HandlerContext.currentPlan

export type { OutputEvent, EngineProgress } from '../generated/handler-types.js';
export type { HandlerContext } from '../generated/handler-types.js';

import type { OutputEvent } from '../generated/handler-types.js';
export type Dispatch = (event: OutputEvent) => void;
