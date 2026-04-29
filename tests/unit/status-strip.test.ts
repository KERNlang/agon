import { describe, expect, it } from 'vitest';

import { buildPlanPhaseGauge } from '../../packages/cli/src/generated/surfaces/status.js';

describe('buildPlanPhaseGauge', () => {
  it('shows the running step and completion percentage', () => {
    const gauge = buildPlanPhaseGauge({
      id: 'cplan-1777467535612-6e3ue9',
      state: 'running',
      steps: [
        { state: 'done', description: 'Write spec' },
        { state: 'running', description: 'Build telemetry dashboard primitives' },
        { state: 'pending', description: 'Wire status command' },
        { state: 'pending', description: 'Verify' },
      ],
    }, 8);

    expect(gauge.visible).toBe(true);
    expect(gauge.shortId).toBe('1777467535');
    expect(gauge.label).toBe('Step 2/4');
    expect(gauge.phase).toBe('executing');
    expect(gauge.pct).toBe(25);
    expect(gauge.done).toBe(1);
    expect(gauge.total).toBe(4);
    expect(gauge.current).toBe('Build telemetry dashboard primitives');
    expect(gauge.bar).toHaveLength(8);
  });

  it('shows paused failed steps as the current phase target', () => {
    const gauge = buildPlanPhaseGauge({
      id: 'cplan-paused',
      state: 'paused',
      steps: [
        { state: 'done', description: 'Spec' },
        { state: 'failed', description: 'Compile generated files' },
        { state: 'pending', description: 'Test' },
      ],
    }, 10);

    expect(gauge.label).toBe('Step 2/3');
    expect(gauge.phase).toBe('paused');
    expect(gauge.failed).toBe(1);
    expect(gauge.color).toBe('#ef4444');
    expect(gauge.current).toBe('Compile generated files');
  });

  it('hides when there is no active plan with steps', () => {
    expect(buildPlanPhaseGauge(null).visible).toBe(false);
    expect(buildPlanPhaseGauge({ state: 'running', steps: [] }).visible).toBe(false);
  });
});
