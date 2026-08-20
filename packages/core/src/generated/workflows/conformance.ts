import type { WorkflowConformanceIssue, WorkflowConformanceCode } from './specs.js';

export function createWorkflowIssue(code: WorkflowConformanceCode, message: string, path?: string): WorkflowConformanceIssue {
  return { code: code, message: message, path: path };
}

export function createWorkflowConformanceError(issues: WorkflowConformanceIssue[], message?: string): Error {
  const err = new Error(message ?? issues.map((i) => i.message).join('; '));
  err.name = 'WorkflowConformanceError';
  (err as Error & { issues: WorkflowConformanceIssue[] }).issues = issues;
  return err;
}

export function throwWorkflowConformance(issues: WorkflowConformanceIssue[], message?: string): never {
  throw createWorkflowConformanceError(issues, message);
}

export function hasWorkflowConformanceErrors(issues: WorkflowConformanceIssue[]): boolean {
  return issues.length > 0;
}
