import { describe, expect, it, vi } from 'vitest';

import { consumeCesarPlanControlSignals } from '../../packages/cli/src/generated/cesar/plan-control-signals.js';

describe('consumeCesarPlanControlSignals', () => {
  it('applies and clears a stashed ProposePlan signal in the same turn', async () => {
    const plan = { id: 'plan-1', state: 'awaiting_approval' };
    const setActivePlan = vi.fn();
    const proposePlan = vi.fn(async () => plan);
    const ctx: any = {
      activePlan: null,
      setActivePlan,
      cesar: { _proposePlanArgs: { intent: 'ship it', steps: [] } },
    };

    const result = await consumeCesarPlanControlSignals({
      ctx,
      dispatch: vi.fn(),
      engineId: 'cesar',
      dispatchToolCall: vi.fn(),
      proposePlan,
      exitPlanMode: vi.fn(),
    });

    expect(proposePlan).toHaveBeenCalledWith({ intent: 'ship it', steps: [] }, expect.any(Function), ctx);
    expect(setActivePlan).toHaveBeenCalledWith(plan);
    expect(ctx.cesar.proposedPlan).toBe(plan);
    expect(ctx.cesar._proposePlanArgs).toBeUndefined();
    expect(result).toEqual({ handled: true, planProposed: true, plan });
  });

  it('applies and clears a stashed ExitPlanMode signal in the same turn', async () => {
    const dispatchToolCall = vi.fn();
    const exitPlanMode = vi.fn(() => 'Plan archived.');
    const ctx: any = { cesar: { _exitPlanModeArgs: { reason: 'done' } } };

    const result = await consumeCesarPlanControlSignals({
      ctx,
      dispatch: vi.fn(),
      engineId: 'cesar',
      dispatchToolCall,
      proposePlan: vi.fn(),
      exitPlanMode,
    });

    expect(exitPlanMode).toHaveBeenCalledWith('done', expect.any(Function), ctx);
    expect(ctx.cesar._exitPlanModeArgs).toBeUndefined();
    expect(dispatchToolCall).toHaveBeenCalledWith(expect.objectContaining({
      tool: 'ExitPlanMode',
      status: 'done',
      output: 'Plan archived.',
    }));
    expect(result).toEqual({ handled: true, planProposed: false });
  });

  it('never leaks a second plan-control scratch signal into a later turn', async () => {
    const plan = { id: 'plan-2', state: 'awaiting_approval' };
    const ctx: any = {
      activePlan: null,
      cesar: {
        _proposePlanArgs: { intent: 'choose one control', steps: [] },
        _exitPlanModeArgs: { reason: 'conflicting second control' },
      },
    };
    const exitPlanMode = vi.fn();

    const result = await consumeCesarPlanControlSignals({
      ctx,
      dispatch: vi.fn(),
      engineId: 'cesar',
      dispatchToolCall: vi.fn(),
      proposePlan: vi.fn(async () => plan),
      exitPlanMode,
    });

    expect(result.planProposed).toBe(true);
    expect(ctx.cesar._proposePlanArgs).toBeUndefined();
    expect(ctx.cesar._exitPlanModeArgs).toBeUndefined();
    expect(exitPlanMode).not.toHaveBeenCalled();
  });
});
