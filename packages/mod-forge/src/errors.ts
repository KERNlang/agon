import { AgonError } from '@kernlang/agon-support-engine-runtime';

export class FitnessError extends AgonError {
  constructor(
    message: string,
    public readonly exitCode?: number,
  ) {
    super(message);
    this.name = 'FitnessError';
  }
}
