import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { handleProposePlan as legacy } from '../fixtures/modular-plan-proposal-publication-legacy.js';
import { handleProposePlan as physical } from '../../packages/cli/src/handlers/plan-mode.js';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';
import { createCesarPlan } from '@kernlang/agon-mod-plan';
import { planCostEstimator } from '@kernlang/agon-core';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';

const roots: string[] = [];
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks(); planCostEstimator.reset();
  for (const root of roots.splice(0)) cleanupTestAgonHome(root);
});
function files(root: string, prefix = ''): Record<string, string> {
  return Object.fromEntries(readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = join(prefix, entry.name);
    return entry.isDirectory() ? Object.entries(files(root, path)) : [[path, readFileSync(join(root, path), 'utf8')]];
  }));
}

it.each([
  { label: 'normal', args: { intent: 'new', steps: [{ id: 'a', type: 'self', description: 'read' }] }, auto: false },
  { label: 'agentic', args: { intent: 'new', steps: [{ id: 'a', type: 'self', description: 'read' }] }, auto: true },
  { label: 'malformed', args: { intent: 3, steps: [null, { type: 'invalid' }, { id: '../escape', type: 'review' }] }, auto: false },
  { label: 'flags', args: { intent: 'new', steps: [], autoApprove: true, selfReview: false, planningCost: { tokens: 99, costUsd: -1 } }, auto: false },
  { label: 'nonarray', args: { intent: 'new', steps: { bogus: true } }, auto: false },
  { label: 'notification changes auto mode', args: { intent: 'new', steps: [null] }, auto: false, flipAuto: true },
])('preserves raw events, state, Markdown, and JSON for $label', async fixture => {
  const { args, auto } = fixture;
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T12:00:00Z'));
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
  const outcomes = [];
  let firstRoot: string | undefined;
  for (const run of [legacy, physical]) {
    const root = setupTestAgonHome('proposal-parity'); roots.push(root);
    if (firstRoot === undefined) firstRoot = root;
    else expect(root).toBe(firstRoot);
    const prior = { ...createCesarPlan('old', []), id: 'prior', state: 'awaiting_approval' as const };
    const active = { ...prior, id: 'active' };
    const ctx = { cesar: { proposedPlan: prior }, activePlan: active, autoModeQueued: auto, config: {} } as unknown as HandlerContext;
    const events: unknown[] = [];
    const result = await run(args, event => {
      events.push(event);
      if ('flipAuto' in fixture && fixture.flipAuto && event.type === 'info') ctx.autoModeQueued = true;
    }, ctx);
    outcomes.push(JSON.stringify({ result, events, proposed: ctx.cesar?.proposedPlan, active: ctx.activePlan, files: files(root) }));
    cleanupTestAgonHome(root); roots.pop();
  }
  expect(outcomes[1]).toBe(outcomes[0]);
});
