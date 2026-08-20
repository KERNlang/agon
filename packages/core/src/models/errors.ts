/**
 * Canonical Agon mode (command) names — single source of truth shared by the EngineNotFoundError mode hint and the Cesar system-prompt MODES-vs-ENGINES note, so the two never drift.
 */
export const AGON_MODE_NAMES: readonly string[] = ['forge', 'brainstorm', 'tribunal', 'campfire', 'council', 'synthesis', 'conquer', 'goal', 'agent', 'pipeline', 'review', 'nero', 'think'];

export class AgonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgonError';
  }
}

export class EngineNotFoundError extends AgonError {
  constructor(
    public readonly engineId: string,
    public readonly installHint?: string,
    public readonly missingBinary?: string,
  ) {
    const modeId = engineId.toLowerCase();
    // missingBinary set ⇒ the engine's CLI binary is absent from PATH (NOT an API-key/env problem). Surface the binary name + an install hint so the user fixes the right thing — the codex incident was a missing binary mis-reported as a missing key.
    const binMsg = missingBinary ? ` — binary "${missingBinary}" not found on PATH${installHint ? `. Install: ${installHint}` : ''}` : '';
    const hint = AGON_MODE_NAMES.includes(modeId) ? `. "${engineId}" is an Agon mode (a command), not an engine — run /${modeId} instead. Engines are backends like codex, claude, or agy.` : (binMsg ? binMsg : (installHint ? `. Install: ${installHint}` : ''));
    super(`Engine "${engineId}" not found${hint}`);
    this.name = 'EngineNotFoundError';
  }
}

export class EngineTimeoutError extends AgonError {
  constructor(
    public readonly engineId: string,
    public readonly timeoutMs: number,
  ) {
    super(`Engine "${engineId}" timed out after ${Math.round((timeoutMs / 1000))}s`);
    this.name = 'EngineTimeoutError';
  }
}

export class FitnessError extends AgonError {
  constructor(
    message: string,
    public readonly exitCode?: number,
  ) {
    super(message);
    this.name = 'FitnessError';
  }
}

export class ConfigError extends AgonError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export class GitError extends AgonError {
  constructor(
    message: string,
    public readonly exitCode?: number,
  ) {
    super(message);
    this.name = 'GitError';
  }
}

export class WorktreeError extends GitError {
  constructor(message: string) {
    super(message);
    this.name = 'WorktreeError';
  }
}

export class PlanStateError extends AgonError {
  constructor(
    public readonly expected: string|string[],
    public readonly actual: string,
  ) {
    const expectedStr = Array.isArray(expected) ? expected.join(' | ') : expected;
    super(`Invalid plan state: expected ${expectedStr}, got ${actual}`);
    this.name = 'PlanStateError';
  }
}
