import React from 'react';
import { render } from 'ink';
import { describe, expect, it } from 'vitest';

import { StatusBar } from '../../packages/cli/src/surfaces/status.js';
import { buildPriorityStatusLine } from '../../packages/cli/src/surfaces/status-helpers.js';
import { createPseudoTty, stripTerminalControl } from '../../packages/cli/src/blocks/frame-capture.js';

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

// Frame capture is the oracle every render assertion in this repo leans on, so
// its CSI matcher has to cover the WHOLE grammar: optional parameter bytes
// (0x30-0x3F), then optional INTERMEDIATE bytes (0x20-0x2F — space through
// slash, which includes '!', '"', '#', '$'), then one final byte. A matcher
// that only knows a couple of intermediates leaks raw escapes into the text a
// test then compares, turning a real regression into a passing string diff.
describe('stripTerminalControl', () => {
  it('strips a CSI sequence that carries an intermediate byte', () => {
    // DECSTR soft reset: ESC [ ! p  — '!' is an intermediate byte.
    expect(stripTerminalControl('before\x1b[!pafter')).toBe('beforeafter');
    // DECSCUSR cursor style: ESC [ 2 SP q
    expect(stripTerminalControl('a\x1b[2 qb')).toBe('ab');
    // DECRQM request: ESC [ ? 2 0 0 4 $ p
    expect(stripTerminalControl('x\x1b[?2004$py')).toBe('xy');
  });

  it('strips ordinary SGR/cursor sequences, OSC titles and carriage returns', () => {
    expect(stripTerminalControl('\x1b[31mred\x1b[0m')).toBe('red');
    expect(stripTerminalControl('\x1b[2J\x1b[Hclean')).toBe('clean');
    expect(stripTerminalControl('\x1b]0;window title\x07kept')).toBe('kept');
    expect(stripTerminalControl('one\r\ntwo')).toBe('one\ntwo');
  });

  it('leaves ordinary text — including brackets — untouched', () => {
    expect(stripTerminalControl('plain [not ansi] text')).toBe('plain [not ansi] text');
  });
});
