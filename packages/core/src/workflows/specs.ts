export type WorkflowMutationLevel = 'none' | 'workspace' | 'network' | 'process';

export type WorkflowPhaseEventType = 'queued' | 'started' | 'completed' | 'failed' | 'skipped' | 'blocked' | 'cancelled';

export type WorkflowRunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';

export type WorkflowConformanceCode = 'duplicate-id' | 'missing-node' | 'cycle' | 'reserved-alias' | 'duplicate-alias' | 'unknown-capability' | 'mutation-denied' | 'plugin-denied' | 'invalid-phase' | 'invalid-registry';

export interface WorkflowCapabilitySpec {
  id: string;
  description?: string;
  mutations?: WorkflowMutationLevel[];
}

export interface WorkflowMutationPolicy {
  allow: boolean;
  maxLevel?: WorkflowMutationLevel;
  capabilities?: string[];
}

export interface WorkflowPhaseSpec {
  id: string;
  label?: string;
  dependsOn?: string[];
  requires?: string[];
  mutation?: WorkflowMutationLevel;
  pluginId?: string;
  meta?: Record<string,unknown>;
}

export interface WorkflowSpec {
  id: string;
  version: string;
  description?: string;
  aliases?: string[];
  capabilities?: WorkflowCapabilitySpec[];
  mutationPolicy?: WorkflowMutationPolicy;
  phases: WorkflowPhaseSpec[];
  plugins?: WorkflowPluginSpec[];
}

export interface WorkflowGraphNodeSpec {
  id: string;
  phaseId?: string;
}

export interface WorkflowGraphEdgeSpec {
  from: string;
  to: string;
}

export interface WorkflowGraphSpec {
  nodes: WorkflowGraphNodeSpec[];
  edges: WorkflowGraphEdgeSpec[];
}

export interface WorkflowExecutionPlanPhase {
  id: string;
  ordinal: number;
  dependsOn: string[];
  requires: string[];
  mutation: WorkflowMutationLevel;
  pluginId?: string;
}

export interface WorkflowExecutionPlan {
  workflowId: string;
  version: string;
  logicalPlanId: string;
  phases: WorkflowExecutionPlanPhase[];
  capabilityPolicy: WorkflowCapabilitySpec[];
  mutationPolicy: WorkflowMutationPolicy;
}

export interface WorkflowPhaseEvent {
  runId: string;
  workflowId: string;
  phaseId: string;
  type: WorkflowPhaseEventType;
  at: string;
  message?: string;
  data?: Record<string,unknown>;
}

export interface WorkflowRun {
  id: string;
  workflowId: string;
  plan: WorkflowExecutionPlan;
  status: WorkflowRunStatus;
  currentPhaseId: string|null;
  events: WorkflowPhaseEvent[];
  startedAt?: string;
  finishedAt?: string;
}

export interface WorkflowConformanceIssue {
  code: WorkflowConformanceCode;
  message: string;
  path?: string;
}

export interface WorkflowPluginSpec {
  id: string;
  trustedAdapter?: boolean;
  source?: 'core'|'trusted-adapter'|'untrusted';
  aliases?: string[];
  capabilities?: WorkflowCapabilitySpec[];
  phases?: WorkflowPhaseSpec[];
  mutationPolicy?: WorkflowMutationPolicy;
}

export interface WorkflowPluginAdmissionOptions {
  allowMutations?: boolean;
  allowCoreSource?: boolean;
  maxMutationLevel?: WorkflowMutationLevel;
  existingPluginIds?: string[];
  existingAliases?: string[];
}

export interface WorkflowPluginAdmissionResult {
  accepted: boolean;
  issues: WorkflowConformanceIssue[];
}
