import { expect, it, vi } from 'vitest';
import type { IntentContribution, ModServices, Registrar } from '@kernlang/agon-mod-api';
import type { DispatchCallbacks } from '../../packages/cli/src/signals/dispatch.js';

const router = vi.hoisted(() => ({ run: vi.fn(async () => false) }));
vi.mock('../../packages/cli/src/signals/dispatch/cesar-router.js', () => ({ routeWithCesar: router.run }));
import { createMod } from '../../packages/mod-plan/src/implementation.js';
import { planSessionHost } from '../../packages/cli/src/plan-session-host.js';
import { runPhysicalTuiContribution } from '../../packages/cli/src/signals/dispatch/intent-session.js';

it('routes a task through Plan mode and does not resume disk state without an explicit ID', async () => {
  const intents: IntentContribution[] = [];
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'intent') intents.push(args[0] as IntentContribution);
    return () => {};
  } }) as Registrar;
  await (await createMod({ planSession: planSessionHost } as ModServices)).activate(registrar);
  const dispatch = vi.fn(); const setActivePlan = vi.fn();
  const cb = { dispatch, setActivePlan, ctx: { config: {} } } as unknown as DispatchCallbacks;
  const plan = intents.find(entry => entry.id === 'intentVariants:0046')!;
  await runPhysicalTuiContribution({ payload: plan }, plan.parse('/plan build parser')!, 'plan', cb, new AbortController().signal);
  expect(router.run).toHaveBeenCalledWith('[PLAN MODE] build parser', [], cb);
  expect(setActivePlan).toHaveBeenCalledWith(expect.objectContaining({ intent: 'build parser' }));
  router.run.mockClear();
  await runPhysicalTuiContribution({ payload: plan }, plan.parse('/plan resume')!, 'plan', cb, new AbortController().signal);
  expect(router.run).not.toHaveBeenCalled();
  expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('No active plan in this session') }));
});
