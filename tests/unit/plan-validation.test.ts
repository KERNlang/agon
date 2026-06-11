import { describe, it, expect } from 'vitest';
import { CESAR_STEP_TYPES } from '../../packages/core/src/generated/cesar/plan.js';
import { sanitizePlanSteps as sanitize } from '../../packages/core/src/generated/cesar/plan-validation.js';

// Regression coverage for the phantom-step crash: Cesar emitted plan steps with
// no `type`/`description`, which flowed through verbatim, corrupted the plan
// markdown ("### Step 4: undefined"), and crashed PlanExecutionView at
// `s.description.slice()`. The boundary validator must drop them.

describe('sanitizePlanSteps — boundary validation of LLM-proposed steps', () => {
  it('drops phantom steps with no valid type and keeps the real ones', () => {
    const { steps, dropped } = sanitize([
      { id: 'a', type: 'self', description: 'real step one' },
      { id: 'b' }, // phantom — no type/description (the crash repro)
      { type: 'forge', description: 'real step two' },
      { id: 'c', type: 'bogus', description: 'unknown type' }, // unexecutable
    ]);
    expect(steps).toHaveLength(2);
    expect(dropped).toBe(2);
    expect(steps.map(s => s.type)).toEqual(['self', 'forge']);
    // Every survivor has a usable string description — never undefined.
    expect(steps.every(s => typeof s.description === 'string' && s.description.length > 0)).toBe(true);
  });

  it('never crashes and returns empty for a non-array (LLM-controlled) container', () => {
    for (const bad of [undefined, null, {}, 'steps', 42, true]) {
      const { steps, dropped } = sanitize(bad as any);
      expect(steps).toEqual([]);
      expect(dropped).toBe(0);
    }
  });

  it('coerces missing / whitespace-only descriptions to a placeholder', () => {
    const { steps } = sanitize([
      { id: 's1', type: 'self' }, // missing description
      { id: 's2', type: 'self', description: '   ' }, // whitespace-only
      { id: 's3', type: 'self', description: 'kept verbatim' },
    ]);
    expect(steps[0].description).toBe('(no description)');
    expect(steps[1].description).toBe('(no description)');
    expect(steps[2].description).toBe('kept verbatim');
  });

  it('accepts every canonical CesarStepType (no false drops)', () => {
    const input = CESAR_STEP_TYPES.map((t, i) => ({ id: `t${i}`, type: t, description: `step ${t}` }));
    const { steps, dropped } = sanitize(input);
    expect(dropped).toBe(0);
    expect(steps).toHaveLength(CESAR_STEP_TYPES.length);
    expect(steps.map(s => s.type).sort()).toEqual([...CESAR_STEP_TYPES].sort());
  });

  it('sanitizes unsafe step ids and applies a non-zero cost estimate', () => {
    const { steps } = sanitize([
      { id: '../../etc/passwd', type: 'forge', description: 'path traversal id' },
      { id: 'ok-id_1', type: 'self', description: 'safe id' },
    ]);
    expect(steps[0].id).not.toContain('/'); // replaced with a safe fallback
    expect(steps[1].id).toBe('ok-id_1'); // already safe — preserved
    expect(steps.every(s => s.estimatedTokens > 0)).toBe(true);
  });

  it('drops everything when all steps are malformed (no survivors)', () => {
    const { steps, dropped } = sanitize([{ id: 'x' }, { foo: 'bar' }, null]);
    expect(steps).toEqual([]);
    expect(dropped).toBe(3);
  });
});
