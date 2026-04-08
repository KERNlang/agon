// ── Intent detection — KERN-sourced ──────────────────────────────────
// Intent union: kern/intent-types.kern → generated/intent-types.ts
// Functions:    kern/intent.kern → generated/intent.ts

export type { Intent } from './generated/intent-types.js';
export type { SlashCommand } from './generated/intent.js';

import { detectIntent as _detectIntent, classifyTask as _classifyTask, SLASH_COMMANDS as _SLASH_COMMANDS } from './generated/intent.js';
import type { Intent } from './generated/intent-types.js';

export function detectIntent(raw: string, commandRegistry?: any): Intent {
  return _detectIntent(raw, commandRegistry) as Intent;
}

export const classifyTask = _classifyTask;
export const SLASH_COMMANDS = _SLASH_COMMANDS;
