import { describe, expect, it, vi, beforeEach } from 'vitest';

const promptDelegationMock = vi.hoisted(() => vi.fn());
// Only the interactive confirmation is stubbed — the delegation OUTCOME shaping
// under test is the real code path.
vi.mock('../../packages/cli/src/cesar/escalation.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/cli/src/cesar/escalation.js')>();
  return { ...actual, promptDelegation: promptDelegationMock };
});

import { commitTurnAndDelegate } from '../../packages/cli/src/cesar/brain.js';
import type { PendingDelegation } from '../../packages/cli/src/handlers/types.js';

function pending(over: Partial<PendingDelegation> = {}): PendingDelegation {
  return {
    action: 'forge',
    task: 'add the retry guard',
    reasoning: 'two plausible designs',
    scope: 'slice',
    hardened: false,
    team: false,
    createdAt: 0,
    ...over,
  } as PendingDelegation;
}

// `turnAlreadyCommitted` keeps the transcript/telemetry writes out of the way;
// what is exercised here is purely how an APPROVED delegation is turned into a
// run mode.
const commit = (p: PendingDelegation) =>
  commitTurnAndDelegate(p, 'input', 'response', 'claude', false, vi.fn(), { chatSession: { messages: [] } } as any, {}, true);

beforeEach(() => {
  promptDelegationMock.mockReset();
  promptDelegationMock.mockResolvedValue({ approved: true });
});

// forge-slice is a DIFFERENT run mode from forge (a bounded single-slice build,
// not a full competitive build). It is earned by exactly one shape: a solo
// forge with scope 'slice'. Every other action keeps its own mode — a guard
// that fired on the complement would relabel brainstorm/tribunal/review runs
// as forge slices.
describe('commitTurnAndDelegate — mode resolution', () => {
  it('maps a solo slice-scoped forge to forge-slice', async () => {
    const outcome = await commit(pending());

    expect(promptDelegationMock).toHaveBeenCalled();
    expect(outcome.delegated).toBe(true);
    expect(outcome.action).toBe('forge');
    expect(outcome.mode).toBe('forge-slice');
  });

  it('leaves a non-forge action on its own mode', async () => {
    const outcome = await commit(pending({ action: 'brainstorm' }));

    expect(outcome.action).toBe('brainstorm');
    expect(outcome.mode).toBe('brainstorm');
  });

  it('leaves a full-scope forge as a plain forge', async () => {
    expect((await commit(pending({ scope: 'full' }))).mode).toBe('forge');
  });

  it('keeps a team forge on the team mode even at slice scope', async () => {
    const outcome = await commit(pending({ team: true }));

    expect(outcome.action).toBe('team-forge');
    expect(outcome.mode).toBe('team-forge');
  });

  it('honours a delegation the user re-pointed at another action', async () => {
    promptDelegationMock.mockResolvedValue({ approved: true, action: 'tribunal' });

    const outcome = await commit(pending());

    expect(outcome.action).toBe('tribunal');
    expect(outcome.mode).toBe('tribunal');
  });

  it('reports a cancelled delegation without a mode', async () => {
    promptDelegationMock.mockResolvedValue({ approved: false });

    const outcome = await commit(pending());

    expect(outcome.delegated).toBe(false);
    expect(outcome.decisionReason).toBe('delegation-cancelled');
    expect(outcome.mode).toBeUndefined();
  });
});
