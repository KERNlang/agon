import { AgonError } from '@kernlang/agon-support-engine-runtime';
export { AGON_MODE_NAMES, AgonError, EngineNotFoundError, EngineTimeoutError } from '@kernlang/agon-support-engine-runtime';

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
