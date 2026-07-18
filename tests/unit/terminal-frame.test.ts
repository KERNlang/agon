import React from 'react';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';

import { StatusBar } from '../../packages/cli/src/generated/surfaces/status.js';
import { buildPriorityStatusLine } from '../../packages/cli/src/generated/surfaces/status-helpers.js';
import { createPseudoTty } from '../../packages/cli/src/generated/blocks/frame-capture.js';

function statusProps(termWidth: number) {
  return {
    cesarId: 'zai-coding-plan-glm-5.2',
    chatMessageCount: 4,
    totalTokens: 240,
    totalCostUsd: 0,
    meteredCostUsd: 0,
    hasPlanApiUsage: true,
    hasCliUsage: false,
    cwd: '~/KERN/agon-with-a-long-workspace-name',
    branch: 'feature/render-stability-with-a-long-name',
    explorationMode: false,
    autoModeQueued: true,
    telemetryVitals: new Map([['zai', { state: 'idle' }]]),
    context: { pct: 15, used: 15_000, limit: 100_000, compacted: 0, cached: 0, source: 'estimate' },
    termWidth,
  };
}

describe('pseudo-TTY terminal frames', () => {
  it('renders a narrow priority footer in one bounded row', async () => {
    const tty = createPseudoTty(40, 16);
    const app = render(React.createElement(StatusBar as any, statusProps(40)), {
      stdout: tty.stdout as any,
      stderr: tty.stderr as any,
      stdin: tty.stdin as any,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    app.unmount();
    await new Promise((resolve) => setTimeout(resolve, 10));

    const expected = buildPriorityStatusLine({
      width: 38,
      cwd: statusProps(40).cwd,
      branch: statusProps(40).branch,
      context: statusProps(40).context,
      tokens: 240,
      messages: 4,
      cost: 'cost included in plan (api)',
      auto: true,
      telemetry: '● idle',
    });
    const output = tty.read();
    expect(tty.stdout.isTTY).toBe(true);
    expect(output).toContain(expected);
    expect(expected).toContain('ctx ~15%');
    expect(expected).toContain('cost included in plan (api)');
    expect(expected.length).toBeLessThanOrEqual(38);
    expect(expected).not.toContain('\n');
  });

  it('reflows from wide to narrow without adding footer rows', async () => {
    const tty = createPseudoTty(100, 30);
    const app = render(React.createElement(StatusBar as any, statusProps(100)), {
      stdout: tty.stdout as any,
      stderr: tty.stderr as any,
      stdin: tty.stdin as any,
      debug: true,
      exitOnCtrlC: false,
      patchConsole: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 15));
    tty.stdout.columns = 40;
    tty.stdout.rows = 16;
    app.rerender(React.createElement(StatusBar as any, statusProps(40)));
    await new Promise((resolve) => setTimeout(resolve, 15));
    app.unmount();

    const narrow = buildPriorityStatusLine({
      width: 38,
      cwd: statusProps(40).cwd,
      branch: statusProps(40).branch,
      context: statusProps(40).context,
      tokens: 240,
      messages: 4,
      cost: 'cost included in plan (api)',
      auto: true,
      telemetry: '● idle',
    });
    expect(tty.read()).toContain(narrow);
    expect(narrow.split('\n')).toHaveLength(1);
  });
});
