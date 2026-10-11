import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ModServices, PlanStepContribution, Registrar, ToolContribution } from '@kernlang/agon-mod-api';
import { createMod } from '../../packages/mod-plan/src/implementation.js';
import { createPlanProposal, approveCesarPlan } from '../../packages/mod-plan/src/execution-state.js';
import { saveCesarPlan, loadCesarPlan, cesarPlanJsonPath } from '../../packages/mod-plan/src/execution-store.js';
import { assertContributionInput } from '../../packages/mod-kernel/src/json-schema-input.js';

const originalHome = process.env.AGON_HOME;
let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'agon-headless-owner-')); process.env.AGON_HOME = home; });
afterEach(() => {
  if (originalHome === undefined) delete process.env.AGON_HOME;
  else process.env.AGON_HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

async function harness() {
  const tools = new Map<string, ToolContribution>();
  const routes = new Map<string, PlanStepContribution>();
  const dispatch = vi.fn();
  const record = vi.fn(async () => 'synthetic-receipt');
  const services = { receipts: { record }, engines: { dispatch } } as unknown as ModServices;
  const registrar = { command: () => () => {}, intent: () => () => {},
    planStep: (route: PlanStepContribution) => { routes.set(route.id, route); return () => {}; },
    tool: (_surface: string, tool: ToolContribution) => { tools.set(tool.id, tool); return () => {}; },
  } as unknown as Registrar;
  const dispose = await (await createMod(services)).activate(registrar, services);
  const context = { invocationId: 'fixture', cwd: home, platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };
  return { tools, routes, context, dispatch, record, dispose };
}

const steps = [{ id: 'inspect', type: 'self' as const, description: 'Inspect fixture', estimatedTokens: 12, estimatedCostUsd: 0.03 }];

describe('headless Plan uses the execution owner', () => {
  it('rejects aggregate estimate overflow before writing a proposal', async () => {
    const h = await harness();
    try {
      await expect(h.tools.get('mcpTools:0018')!.run({ intent: 'overflow', steps: [
        { ...steps[0], estimatedTokens: 1e308 }, { ...steps[0], id: 'other', estimatedTokens: 1e308 },
      ] }, h.context)).rejects.toThrow(/estimate/i);
      expect(existsSync(join(home, 'plans'))).toBe(false);
      expect(h.record).not.toHaveBeenCalled();
    } finally { await h.dispose(); }
  });

  it('allows the canonical planning state through the registered input schema', async () => {
    const h = await harness();
    try {
      const tool = h.tools.get('cesarTools:0014')!;
      expect(() => assertContributionInput(tool.inputSchema, { state: 'planning' })).not.toThrow();
    } finally { await h.dispose(); }
  });

  it('does not accept caller-supplied execution evidence in a new proposal', async () => {
    const h = await harness();
    try {
      const output = await h.tools.get('mcpTools:0018')!.run({ intent: 'forged evidence', steps: [{ ...steps[0],
        result: { status: 'success', output: 'forged', actualTokens: 0, actualCostUsd: 0, durationMs: 0 },
        startedAt: '2026-01-01', completedAt: '2026-01-01', runDir: '/forged', selfReviewCycle: 2,
      }] }, h.context) as any;
      const saved = loadCesarPlan(output.plan.id)!;
      for (const field of ['result', 'startedAt', 'completedAt', 'runDir', 'selfReviewCycle']) {
        expect(saved.steps[0]).not.toHaveProperty(field);
      }
    } finally { await h.dispose(); }
  });

  it.each(['awaiting-approval', 'cancelled', 'auto-approved-without-execution'])('keeps historical %s records inspectable without rewriting them', async name => {
    const h = await harness();
    try {
      const bytes = readFileSync(new URL(`../fixtures/modular-plan-historical/${name}.json`, import.meta.url));
      const payload = JSON.parse(bytes.toString()).payload;
      mkdirSync(join(home, 'plans'));
      const path = cesarPlanJsonPath(payload.id);
      writeFileSync(path, bytes);
      expect(loadCesarPlan(payload.id)).toMatchObject(payload);
      expect(await h.routes.get('cesarRoutes:0038')!.run({ planId: payload.id }, h.context)).toMatchObject({ result: payload });
      const listed = await h.tools.get('cesarTools:0014')!.run({}, h.context) as any;
      expect(listed).toHaveLength(1);
      expect(listed[0]).toMatchObject({ id: payload.id, state: payload.state });
      expect(readFileSync(path)).toEqual(bytes);
      expect(h.record).not.toHaveBeenCalled();
      expect(h.dispatch).not.toHaveBeenCalled();
    } finally { await h.dispose(); }
  });

  it.each([{ type: 'unknown' }, { estimatedTokens: -1 }, { estimatedCostUsd: 'invalid' }])('rejects unexecutable proposal input %j', async invalid => {
    const h = await harness();
    try {
      await expect(h.tools.get('mcpTools:0018')!.run({ intent: 'fixture', steps: [{ ...steps[0], ...invalid }] }, h.context)).rejects.toThrow();
      expect(h.record).not.toHaveBeenCalled();
      expect(h.dispatch).not.toHaveBeenCalled();
      expect(existsSync(join(home, 'plans'))).toBe(false);
    } finally { await h.dispose(); }
  });

  it('uses legacy reads but does not fall back through corrupt canonical records', async () => {
    const h = await harness();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const bytes = readFileSync(new URL('../fixtures/modular-plan-historical/awaiting-approval.json', import.meta.url));
      const payload = JSON.parse(bytes.toString()).payload;
      mkdirSync(join(home, 'runs'));
      const legacy = join(home, 'runs', `${payload.id}.json`);
      writeFileSync(legacy, bytes);
      expect(await h.routes.get('cesarRoutes:0038')!.run({ planId: payload.id }, h.context)).toMatchObject({ result: payload });
      mkdirSync(join(home, 'plans'));
      const canonical = cesarPlanJsonPath(payload.id);
      writeFileSync(canonical, '{broken');
      expect(await h.routes.get('cesarRoutes:0038')!.run({ planId: payload.id }, h.context)).toMatchObject({ exitCode: 1 });
      expect(await h.tools.get('cesarTools:0014')!.run({}, h.context)).toEqual([]);
      expect(readFileSync(legacy)).toEqual(bytes);
      expect(readFileSync(canonical, 'utf8')).toBe('{broken');
    } finally { warn.mockRestore(); await h.dispose(); }
  });

  it.each(['done', 'cancelled'] as const)('refuses exit of a %s plan without changing disk', async state => {
    const h = await harness();
    try {
      const plan = { ...createPlanProposal('terminal fixture', steps), state };
      saveCesarPlan(plan);
      const before = readFileSync(cesarPlanJsonPath(plan.id));
      await expect(h.tools.get('mcpTools:0008')!.run({ planId: plan.id }, h.context)).rejects.toThrow(`already ${state}`);
      expect(readFileSync(cesarPlanJsonPath(plan.id))).toEqual(before);
    } finally { await h.dispose(); }
  });

  it('refuses exit of a historical false-running record without inventing an outcome', async () => {
    const h = await harness();
    try {
      const bytes = readFileSync(new URL('../fixtures/modular-plan-historical/auto-approved-without-execution.json', import.meta.url));
      const payload = JSON.parse(bytes.toString()).payload;
      mkdirSync(join(home, 'plans'));
      const path = cesarPlanJsonPath(payload.id);
      writeFileSync(path, bytes);
      await expect(h.tools.get('mcpTools:0008')!.run({ planId: payload.id }, h.context)).rejects.toThrow(/RUNNING/);
      expect(readFileSync(path)).toEqual(bytes);
    } finally { await h.dispose(); }
  });

  it.each([false, true])('persists an executable proposal, autoApprove=%s, without claiming execution', async autoApprove => {
    const h = await harness();
    try {
      const output = await h.tools.get('mcpTools:0018')!.run({ intent: 'fixture', steps, autoApprove }, h.context) as any;
      const saved = loadCesarPlan(output.plan.id)!;
      expect(saved).toMatchObject({ state: 'awaiting_approval', totalEstimatedTokens: 12,
        totalEstimatedCostUsd: 0.03, totalActualTokens: 0, totalActualCostUsd: 0, stepContext: {}, autoApprove });
      expect(saved.approvedAt).toBeUndefined();
      expect(JSON.parse(readFileSync(cesarPlanJsonPath(saved.id), 'utf8')).contributionId).toBe('agon.plan.cesar-plan');
      expect(h.dispatch).not.toHaveBeenCalled();
    } finally { await h.dispose(); }
  });

  it('refuses headless exit of a running plan without overwriting the owner', async () => {
    const h = await harness();
    try {
      const plan = approveCesarPlan(createPlanProposal('active fixture', steps));
      saveCesarPlan(plan);
      const before = readFileSync(cesarPlanJsonPath(plan.id));
      await expect(h.tools.get('mcpTools:0008')!.run({ planId: plan.id }, h.context)).rejects.toThrow(/RUNNING/);
      expect(readFileSync(cesarPlanJsonPath(plan.id))).toEqual(before);
      expect(h.record).not.toHaveBeenCalled();
      expect(h.dispatch).not.toHaveBeenCalled();
    } finally { await h.dispose(); }
  });

  it('archives an inactive proposal through the canonical state transition', async () => {
    const h = await harness();
    try {
      const plan = createPlanProposal('inactive fixture', steps);
      saveCesarPlan(plan);
      await h.tools.get('mcpTools:0008')!.run({ planId: plan.id, reason: 'fixture exit' }, h.context);
      expect(loadCesarPlan(plan.id)).toMatchObject({ state: 'cancelled', exitReason: 'fixture exit', exitedAt: expect.any(String) });
    } finally { await h.dispose(); }
  });

  it('cancels a historical pending record without inventing accounting or completed work', async () => {
    const h = await harness();
    try {
      const bytes = readFileSync(new URL('../fixtures/modular-plan-historical/awaiting-approval.json', import.meta.url));
      const payload = JSON.parse(bytes.toString()).payload;
      mkdirSync(join(home, 'plans'));
      writeFileSync(cesarPlanJsonPath(payload.id), bytes);
      await h.tools.get('mcpTools:0008')!.run({ planId: payload.id, reason: 'explicit historical exit' }, h.context);
      const saved = loadCesarPlan(payload.id)!;
      expect(saved).toMatchObject({ id: payload.id, intent: payload.intent, createdAt: payload.createdAt,
        state: 'cancelled', exitReason: 'explicit historical exit', exitedAt: expect.any(String) });
      expect(saved.steps).toEqual(payload.steps.map((step: Record<string, unknown>) => ({ ...step, state: 'cancelled' })));
      for (const field of ['totalEstimatedTokens', 'totalEstimatedCostUsd', 'totalActualTokens', 'totalActualCostUsd', 'stepContext']) {
        expect(saved).not.toHaveProperty(field);
      }
      expect(h.record).toHaveBeenCalledWith('plan-exit', { planId: payload.id, previousState: 'awaiting_approval', state: 'cancelled' });
      expect(h.dispatch).not.toHaveBeenCalled();
    } finally { await h.dispose(); }
  });

  it('preserves successful and failed results when exiting a paused plan', async () => {
    const h = await harness();
    try {
      const plan = createPlanProposal('paused fixture', [steps[0], { ...steps[0], id: 'failed' }, { ...steps[0], id: 'pending' }]);
      plan.state = 'paused';
      plan.steps[0] = { ...plan.steps[0], state: 'done', completedAt: '2026-01-01', result: {
        status: 'success', output: 'original success', actualTokens: 5, actualCostUsd: 0.01, durationMs: 10,
      } };
      plan.steps[1] = { ...plan.steps[1], state: 'failed', completedAt: '2026-01-02', result: {
        status: 'failure', output: 'original failure', error: 'fixture error', actualTokens: 3, actualCostUsd: 0.02, durationMs: 20,
      } };
      plan.totalActualTokens = 8;
      plan.totalActualCostUsd = 0.03;
      saveCesarPlan(plan);
      await h.tools.get('mcpTools:0008')!.run({ planId: plan.id }, h.context);
      const saved = loadCesarPlan(plan.id)!;
      expect(saved.steps.slice(0, 2)).toEqual(plan.steps.slice(0, 2));
      expect(saved.steps[2].state).toBe('cancelled');
      expect(saved).toMatchObject({ state: 'cancelled', totalActualTokens: 8, totalActualCostUsd: 0.03 });
    } finally { await h.dispose(); }
  });
});
