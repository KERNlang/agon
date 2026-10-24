export const CESAR_PLAN_STATES = ['planning', 'awaiting_approval', 'running', 'paused', 'done', 'cancelled'] as const;
export type CesarPlanState = typeof CESAR_PLAN_STATES[number];

export type CesarStepState = 'pending' | 'blocked' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled';

export type CesarStepType = 'self' | 'forge' | 'teamforge' | 'delegate' | 'brainstorm' | 'campfire' | 'tribunal' | 'pipeline' | 'review' | 'agent' | 'team-agent';

export const CESAR_STEP_TYPE_TABLE: Record<CesarStepType, true> = ({ self: true, forge: true, teamforge: true, delegate: true, brainstorm: true, campfire: true, tribunal: true, pipeline: true, review: true, agent: true, 'team-agent': true });

export const CESAR_STEP_TYPES: CesarStepType[] = (Object.keys(CESAR_STEP_TYPE_TABLE) as CesarStepType[]);

export interface CesarStepResult {
  status: 'success'|'failure'|'paused';
  actualTokens: number;
  actualCostUsd: number;
  durationMs: number;
  output: string;
  error?: string;
  /** The executor records this only after it observes the application outcome. */
  artifact?: { status: 'applied'; cwd: string; patchPath: string; patchHash: string }
    | { status: 'not-needed'; cwd: string; reason: 'already-satisfied' | 'empty-patch' };
}

export interface CesarPlanStep {
  id: string;
  type: CesarStepType;
  description: string;
  engines?: string[];
  engine?: string;
  fitnessCmd?: string;
  tribunalMode?: string;
  parallel?: boolean;
  dependsOn?: string[];
  exports?: string[];
  imports?: string[];
  estimatedTokens: number;
  estimatedCostUsd: number;
  eloSpread?: number;
  rationale?: string;
  verifyCmd?: string;
  state?: CesarStepState;
  result?: CesarStepResult;
  startedAt?: string;
  completedAt?: string;
  runDir?: string;
  /** Assigned by the coordinator to its appended verification step. */
  selfReviewCycle?: number;
}

/**
 * Set when Cesar leaves plan mode via ExitPlanMode — the plan is archived as cancelled with the reason Cesar gave, so the exit is auditable and the proposal isn't silently erased.
 */
export interface CesarPlan {
  id: string;
  state: CesarPlanState;
  intent: string;
  steps: CesarPlanStep[];
  planningCost?: {tokens:number,costUsd:number};
  totalEstimatedTokens: number;
  totalEstimatedCostUsd: number;
  totalActualTokens: number;
  totalActualCostUsd: number;
  stepContext: Record<string, string>;
  createdAt: string;
  updatedAt?: string;
  activeStepId?: string|null;
  currentStepId?: string|null;
  approvedAt?: string;
  completedAt?: string;
  planFilePath?: string;
  autoApprove?: boolean;
  selfReview?: boolean;
  reviewCyclesUsed?: number;
  fallbackRetriesUsed?: Record<string, number>;
  exitReason?: string;
  exitedAt?: string;
}
