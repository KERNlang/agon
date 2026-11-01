import { chmodSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { DurableModHost, createFirstPartyModCatalog, createFullCompatDesiredState, planDesiredStateChange } from '@kernlang/agon-kernel';
import { createCesarPlan, loadCesarPlan, saveCesarPlan } from '@kernlang/agon-mod-plan';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';
import { disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';
import { handleProposePlan, handleExitPlanMode } from '../../packages/cli/src/handlers/plan-mode.js';
import { consumeCesarPlanControlSignals } from '../../packages/cli/src/cesar/plan-control-signals.js';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';

let root: string | undefined;
afterEach(async () => {
  await disposeProcessSurfaceAuthority();
  if (root) {
    const generations = join(root, 'host', 'generations');
    for (const name of readdirSync(generations)) chmodSync(join(generations, name), 0o755);
    cleanupTestAgonHome(root);
    root = undefined;
  }
});

function files(path: string): Record<string, string> {
  return Object.fromEntries(readdirSync(path, { withFileTypes: true }).flatMap(entry => {
    const full = join(path, entry.name);
    return entry.isDirectory() ? Object.entries(files(full)) : [[full, readFileSync(full).toString('base64')]];
  }));
}
const NOW = '2026-10-30T00:00:00.000Z';
it.each((['enabled', 'disabled', 'stale'] as const).flatMap(selection =>
  (['direct', 'scratch-signal'] as const).map(route => ({ selection, route }))))(
  'checks proposal publication before effects ($selection, $route)', async ({ selection, route }) => {
    root = setupTestAgonHome('plan-publication-authority');
    const hostRoot = join(root, 'host');
    const host = new DurableModHost(hostRoot, { kernelVersion: '1.0.0', processIdentity: 'publication-test' });
    const catalog = createFirstPartyModCatalog();
    const full = createFullCompatDesiredState(catalog, NOW);
    const disabled = planDesiredStateChange(catalog, full, { kind: 'disable', id: 'agon.plan' }, NOW).nextState;
    const install = async (isDisabled: boolean) => {
      const desiredState = isDisabled ? disabled : full;
      await host.commitGeneration({ operation: isDisabled ? 'disable' : 'install',
        lock: await surfaceLockFor(desiredState), desiredState, installedIndex: {} });
    };
    await install(selection === 'disabled');
    await initializeProcessSurfaceAuthority(hostRoot);
    if (selection === 'stale') await install(true);
    const prior = { ...createCesarPlan('prior', []), state: 'awaiting_approval' as const };
    saveCesarPlan(prior);
    const args = { intent: 'replacement', steps: [{ id: 'read', type: 'review', description: 'inspect' }] };
    const dispatch = vi.fn();
    const setActivePlan = vi.fn();
    const ctx = { config: {}, cesar: { proposedPlan: prior, _proposePlanArgs: args }, setActivePlan } as unknown as HandlerContext;
    const before = files(root);
    let error: unknown;
    let result;
    if (route === 'direct') {
      try { result = await handleProposePlan(args, dispatch, ctx); }
      catch (caught) { error = caught; }
    } else {
      const signal = await consumeCesarPlanControlSignals({ ctx, dispatch, engineId: 'fixture',
        dispatchToolCall: vi.fn(), proposePlan: handleProposePlan, exitPlanMode: handleExitPlanMode });
      result = signal.plan;
      error = signal.error;
      expect(signal.planProposed).toBe(selection === 'enabled');
      expect(ctx.cesar!._proposePlanArgs).toBeUndefined();
    }
    if (selection !== 'enabled') {
      expect(files(root)).toEqual(before);
      expect(String(error)).toMatch(/unavailable|restart Agon/);
      expect(dispatch).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'plan-proposal' }));
      expect(ctx.cesar!.proposedPlan).toBe(prior);
      expect(setActivePlan).not.toHaveBeenCalled();
      return;
    }
    expect(error).toBeUndefined();
    expect(result).toMatchObject({ intent: 'replacement', state: 'awaiting_approval' });
    expect(loadCesarPlan(result!.id)).toMatchObject({ intent: 'replacement' });
    expect(loadCesarPlan(prior.id)?.state).toBe('cancelled');
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'plan-proposal', plan: result }));
  });
