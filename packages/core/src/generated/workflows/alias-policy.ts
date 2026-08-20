import type { WorkflowConformanceIssue } from './specs.js';

import { createWorkflowIssue, throwWorkflowConformance } from './conformance.js';

/**
 * Aliases reserved by the core workflow shell and registry namespace. Workflow specs and plugins cannot claim these names.
 */
export const RESERVED_WORKFLOW_ALIASES: readonly string[] = ['help', 'run', 'workflow', 'workflows', 'kern', 'core', 'plugin', 'plugins', 'new', 'delete', 'list', 'default'];

export function normalizeWorkflowAlias(alias: string): string {
  return String(alias ?? '').trim().toLowerCase();
}

export function validateWorkflowAliases(aliases: string[], pathPrefix?: string): WorkflowConformanceIssue[] {
  const issues: WorkflowConformanceIssue[] = [];
  const seen = new Map<string, number>();
  aliases.forEach((raw, index) => {
    const alias = normalizeWorkflowAlias(raw);
    const path = `${pathPrefix ?? 'aliases'}[${index}]`;
    if (!alias) {
      issues.push(createWorkflowIssue('invalid-registry', 'Workflow alias cannot be empty', path));
      return;
    }
    if (RESERVED_WORKFLOW_ALIASES.includes(alias)) {
      issues.push(createWorkflowIssue('reserved-alias', `Workflow alias "${alias}" is reserved`, path));
    }
    const first = seen.get(alias);
    if (first !== undefined) {
      issues.push(createWorkflowIssue('duplicate-alias', `Workflow alias "${alias}" duplicates aliases[${first}]`, path));
    }
    seen.set(alias, first ?? index);
  });
  return issues;
}

export function assertWorkflowAliasesAllowed(aliases: string[], pathPrefix?: string): void {
  const issues = validateWorkflowAliases(aliases, pathPrefix);
  if (issues.length > 0) throwWorkflowConformance(issues, 'Workflow alias policy rejected the spec');
}
