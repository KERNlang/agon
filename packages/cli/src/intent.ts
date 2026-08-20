// Public intent surface: the Intent union from ./signals/intent-types.ts and
// the parsing helpers from ./signals/intent.ts, re-typed for consumers.

export type { Intent } from './signals/intent-types.js';
export type { SlashCommand } from './signals/intent.js';

import { detectIntent as _detectIntent, classifyTask as _classifyTask, SLASH_COMMANDS as _SLASH_COMMANDS } from './signals/intent.js';
import type { Intent } from './signals/intent-types.js';

export function detectIntent(raw: string, commandRegistry?: any): Intent {
  return _detectIntent(raw, commandRegistry) as Intent;
}

export const classifyTask = _classifyTask;
export const SLASH_COMMANDS = _SLASH_COMMANDS;
