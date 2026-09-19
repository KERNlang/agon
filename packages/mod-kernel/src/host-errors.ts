export type DurableHostErrorCode =
  | 'MOD_HOST_BUSY'
  | 'MOD_FENCE_LOST'
  | 'MOD_GENERATION_CORRUPT'
  | 'MOD_POINTER_CORRUPT'
  | 'MOD_RESTART_REQUIRED'
  | 'MOD_MIGRATION_FAILED'
  | 'MOD_TRANSACTION_FAILED'
  | 'MOD_TRANSACTION_CONFLICT'
  | 'MOD_SAFE_MODE';

export class DurableHostError extends Error {
  readonly code: DurableHostErrorCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(code: DurableHostErrorCode, message: string, details: Readonly<Record<string, unknown>> = {}) {
    super(message);
    this.name = 'DurableHostError';
    this.code = code;
    this.details = Object.freeze({ ...details });
  }
}

export class SimulatedHostCrash extends Error {
  constructor(readonly point: string) { super("simulated host crash at " + point); this.name = "SimulatedHostCrash"; }
}
