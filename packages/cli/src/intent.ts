// ── Intent detection — KERN-sourced, DU facade ─────────────────────
// Source of truth: kern/intent.kern → generated/intent.ts
// This file re-exports with discriminated union type for TS consumers.

import {
  detectIntent as _detectIntent,
  SLASH_COMMANDS as _SLASH_COMMANDS,
} from './generated/intent.js';
export type { SlashCommand } from './generated/intent.js';

export type Intent =
  | { type: 'forge'; task: string; fitnessCmd: string | null }
  | { type: 'brainstorm'; question: string }
  | { type: 'tribunal'; question: string }
  | { type: 'leaderboard' }
  | { type: 'history'; id?: string }
  | { type: 'engines' }
  | { type: 'config'; action?: string; key?: string; value?: string }
  | { type: 'campfire'; topic: string }
  | { type: 'workspace'; action: string; path?: string }
  | { type: 'use'; engineIds: string[] }
  | { type: 'models' }
  | { type: 'tokens' }
  | { type: 'plan'; planId?: string }
  | { type: 'plans' }
  | { type: 'approve' }
  | { type: 'retry' }
  | { type: 'cancel' }
  | { type: 'img'; path: string }
  | { type: 'chat'; input: string }
  | { type: 'discover' }
  | { type: 'apply'; patchPath?: string; force?: boolean }
  | { type: 'cp'; index?: number }
  | { type: 'flow' }
  | { type: 'flows' }
  | { type: 'chats'; sessionId?: string }
  | { type: 'build'; input: string }
  | { type: 'pipeline'; task: string; fitnessCmd: string | null }
  | { type: 'run'; input: string }
  | { type: 'cesar'; input: string }
  | { type: 'clear' }
  | { type: 'slash-list' }
  | { type: 'help' }
  | { type: 'exit' }
  | { type: 'unknown'; input: string };

export function detectIntent(raw: string): Intent {
  return _detectIntent(raw) as Intent;
}

export const SLASH_COMMANDS = _SLASH_COMMANDS;
