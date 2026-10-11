import { CESAR_PLAN_STATES, CESAR_STEP_TYPE_TABLE } from './execution-model.js';
import type { CesarPlan, CesarPlanStep, CesarStepResult } from './execution-model.js';
import { planGraphError, planParallelWriterError } from './dependency-graph.js';

type RecordValue = Record<string, unknown>;
const object = (value: unknown): value is RecordValue =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const string = (value: unknown): value is string => typeof value === 'string';
const number = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => number(value) && value >= 0;
const counter = (value: unknown): value is number => nonnegative(value) && Number.isSafeInteger(value);
const boolean = (value: unknown): value is boolean => typeof value === 'boolean';
const optional = (value: RecordValue, keys: string[], accepts: (item: unknown) => boolean): boolean =>
  keys.every(key => value[key] === undefined || accepts(value[key]));
function array(value: unknown, accepts: (item: unknown) => boolean): boolean {
  if (!Array.isArray(value)) return false;
  for (const item of value) if (!accepts(item)) return false;
  return true;
}
const strings = (value: unknown): boolean => array(value, string);
const dictionary = (value: unknown, accepts: (item: unknown) => boolean): boolean =>
  object(value) && Object.values(value).every(accepts);

export function isCesarStepResult(value: unknown): value is CesarStepResult {
  return object(value) && string(value.status) && ['success', 'failure', 'paused'].includes(value.status)
    && ['actualTokens', 'actualCostUsd', 'durationMs'].every(key => nonnegative(value[key]))
    && string(value.output) && optional(value, ['error'], string);
}

export function isPersistedCesarPlanStep(value: unknown): value is CesarPlanStep {
  return object(value) && string(value.id) && value.id.length > 0
    && string(value.type) && Object.hasOwn(CESAR_STEP_TYPE_TABLE, value.type)
    && string(value.description) && nonnegative(value.estimatedTokens) && nonnegative(value.estimatedCostUsd)
    && optional(value, ['engine', 'fitnessCmd', 'tribunalMode', 'rationale', 'verifyCmd', 'startedAt', 'completedAt', 'runDir'], string)
    && optional(value, ['engines', 'dependsOn', 'exports', 'imports'], strings)
    && optional(value, ['parallel'], boolean)
    && optional(value, ['eloSpread'], number)
    && optional(value, ['selfReviewCycle'], counter)
    && optional(value, ['state'], item => string(item) && ['pending', 'blocked', 'running', 'done', 'failed', 'skipped', 'cancelled'].includes(item))
    && optional(value, ['result'], isCesarStepResult);
}

/** A returned value did not prove the outcome of an attempted effect. */
export class UnknownPlanOutcomeError extends Error {
  constructor() {
    super('Plan backend returned an invalid outcome. Work may have run. Inspect its artifacts before retrying; no result or cost was invented.');
    this.name = 'UnknownPlanOutcomeError';
  }
}

/** Validate the execution shape without normalizing, repairing, or rewriting it.
 * Historical incomplete records require explicit migration, not invented data. */
export function isPersistedCesarPlan(value: unknown, expectedId: string): value is CesarPlan {
  return object(value) && string(value.id) && value.id.length > 0 && value.id === expectedId
    && string(value.state) && (CESAR_PLAN_STATES as readonly string[]).includes(value.state)
    && string(value.intent) && string(value.createdAt) && array(value.steps, isPersistedCesarPlanStep)
    && ['totalEstimatedTokens', 'totalEstimatedCostUsd', 'totalActualTokens', 'totalActualCostUsd'].every(key => nonnegative(value[key]))
    && dictionary(value.stepContext, string)
    && optional(value, ['updatedAt', 'approvedAt', 'completedAt', 'planFilePath', 'exitReason', 'exitedAt'], string)
    && optional(value, ['activeStepId', 'currentStepId'], item => item === null
      || (string(item) && (value.steps as CesarPlanStep[]).some(step => step.id === item)))
    && optional(value, ['autoApprove', 'selfReview'], boolean)
    && optional(value, ['reviewCyclesUsed'], counter)
    && optional(value, ['fallbackRetriesUsed'], item => dictionary(item, counter))
    && optional(value, ['planningCost'], item => object(item) && nonnegative(item.tokens) && nonnegative(item.costUsd))
    && planGraphError(value.steps as CesarPlanStep[]) === undefined
    && planParallelWriterError(value.steps as CesarPlanStep[]) === undefined;
}

/** Refuse incomplete records before effects; historical inspection stays available. */
export function assertExecutablePlan(value: unknown): asserts value is CesarPlan {
  if (!object(value) || !string(value.id) || !isPersistedCesarPlan(value, value.id)) {
    throw new Error('Invalid or incomplete Plan execution record. Saved data is unchanged. Inspect the saved plan and create a new proposal before starting work; do not fill missing outcomes or costs by guesswork.');
  }
}
