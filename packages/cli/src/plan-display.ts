// ── Plan Display ──────────────────────────────────────────────────────
// Terminal rendering for plan preview, status, and history.

import type { Plan, PlanStep, StepState } from '@agon/core';
import {
  bold, dim, cyan, green, red, yellow, white, fg256, info, table,
} from './output.js';

const STATE_ICONS: Record<StepState, string> = {
  pending: '○',
  running: '◉',
  completed: '✓',
  failed: '✗',
  skipped: '⊘',
};

const STATE_FNS: Record<StepState, (t: string) => string> = {
  pending: dim,
  running: cyan,
  completed: green,
  failed: red,
  skipped: dim,
};

/**
 * Display a full plan with all steps and status.
 */
export function displayPlan(plan: Plan): void {
  const actionLabel = plan.action.type === 'forge' ? 'Forge' : 'Build';

  console.log('');
  console.log(`  ${bold(white(`Plan: ${actionLabel}`))}  ${dim(plan.id)}`);
  console.log(`  ${dim('─'.repeat(52))}`);

  // Action details
  console.log(`  ${bold('Task:')} ${plan.action.task}`);
  if (plan.action.fitnessCmd) {
    console.log(`  ${bold('Test:')} ${plan.action.fitnessCmd}`);
  }
  if (plan.action.engines && plan.action.engines.length > 0) {
    console.log(`  ${bold('Engines:')} ${plan.action.engines.join(', ')}`);
  }
  if (plan.action.engineId) {
    console.log(`  ${bold('Engine:')} ${plan.action.engineId}`);
  }
  console.log('');

  // Steps
  for (const step of plan.steps) {
    const icon = STATE_ICONS[step.result.state];
    const colorFn = STATE_FNS[step.result.state];
    const engine = step.engineId ? dim(` (${step.engineId})`) : '';
    const score = step.result.score != null ? dim(` → ${step.result.score} pts`) : '';
    const duration = step.result.durationMs != null
      ? dim(` ${Math.round(step.result.durationMs / 1000)}s`)
      : '';
    console.log(`  ${colorFn(icon)} ${colorFn(step.label)}${engine}${score}${duration}`);
  }

  // Summary
  console.log('');
  const completed = plan.steps.filter((s) => s.result.state === 'completed').length;
  const total = plan.steps.length;
  const ws = plan.workspace;
  const wsStatus = ws.dirty ? yellow('dirty') : green('clean');
  console.log(
    `  ${dim(`State: ${plan.state}  |  ${completed}/${total} steps  |  ${ws.branch} (${wsStatus})`)}`,
  );
  console.log('');
}

/**
 * One-line plan summary for list views.
 */
export function displayPlanSummary(plan: Plan): string {
  const actionLabel = plan.action.type === 'forge' ? '⚔ forge' : '🔨 build';
  const completed = plan.steps.filter((s) => s.result.state === 'completed').length;
  const total = plan.steps.length;

  const stateIcon =
    plan.state === 'completed' ? green('✓') :
    plan.state === 'failed' ? red('✗') :
    plan.state === 'running' ? cyan('◉') :
    plan.state === 'paused' ? yellow('⏸') :
    plan.state === 'cancelled' ? dim('⊘') : dim('○');

  const task = plan.action.task.length > 40
    ? plan.action.task.slice(0, 37) + '...'
    : plan.action.task;

  return `${stateIcon} ${actionLabel}  ${task}  ${dim(`[${completed}/${total}]`)}  ${dim(plan.id)}`;
}

/**
 * Display a list of plans as a table.
 */
export function displayPlanList(plans: Plan[]): void {
  if (plans.length === 0) {
    info('No plans found.');
    return;
  }

  console.log('');
  console.log(`  ${bold(white('Plans'))}`);
  console.log(`  ${dim('─'.repeat(52))}`);
  for (const plan of plans) {
    console.log(`  ${displayPlanSummary(plan)}`);
  }
  console.log('');
}
