export class AgonError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AgonError';
  }
}

export class EngineNotFoundError extends AgonError {
  constructor(
    public readonly engineId: string,
    public readonly installHint?: string,
  ) {
    super(
      `Engine "${engineId}" not found` +
        (installHint ? `. Install: ${installHint}` : ''),
    );
    this.name = 'EngineNotFoundError';
  }
}

export class EngineTimeoutError extends AgonError {
  constructor(
    public readonly engineId: string,
    public readonly timeoutMs: number,
  ) {
    super(
      `Engine "${engineId}" timed out after ${Math.round(timeoutMs / 1000)}s`,
    );
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
