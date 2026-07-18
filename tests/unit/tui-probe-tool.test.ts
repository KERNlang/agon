import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  TUI_PROBE_INPUT_SAFELIST,
  createTuiProbeTool,
  resolveTuiProbePaths,
} from '../../packages/cli/src/generated/cesar/tool-tui-probe.js';

const ctx = {} as never;

describe('TuiProbe tool', () => {
  it('exposes a read-only, non-concurrency-safe definition', () => {
    const tool = createTuiProbeTool();
    expect(tool.definition.name).toBe('TuiProbe');
    expect(tool.definition.isReadOnly).toBe(true);
    expect(tool.definition.isConcurrencySafe).toBe(false);
  });

  it('validate rejects non-safelisted input (layout probe never dispatches engines)', () => {
    const tool = createTuiProbeTool();
    expect(tool.validate({ input: 'review the auth code' }, ctx)).toMatch(/must start with one of/);
    expect(tool.validate({ input: '/forge do things' }, ctx)).toMatch(/must start with one of/);
    for (const allowed of TUI_PROBE_INPUT_SAFELIST) {
      expect(tool.validate({ input: allowed }, ctx)).toBeNull();
    }
    // default (no input) is /help — allowed
    expect(tool.validate({}, ctx)).toBeNull();
  });

  it('validate rejects control characters — a newline must not smuggle a second command past the prefix check', () => {
    const tool = createTuiProbeTool();
    // agon-review blocking finding: the PTY submits on newline, so a safelisted
    // first line followed by an engine-dispatching second line is an injection.
    expect(tool.validate({ input: '/help x\n/forge rm -rf' }, ctx)).toMatch(/single line without control characters/);
    expect(tool.validate({ input: '/help\r/council attack' }, ctx)).toMatch(/single line|must start with one of/);
    expect(tool.validate({ input: '/help [A' }, ctx)).toMatch(/single line without control characters/);
    // prefix must be exact or followed by a space
    expect(tool.validate({ input: '/helpanything' }, ctx)).toMatch(/must start with one of/);
  });

  it('resolves the probe script inside the package py/ dir', () => {
    const { script } = resolveTuiProbePaths();
    expect(script).toBeTruthy();
    expect(script).toMatch(/packages\/cli\/py\/agon-tui-probe\.py$|@kernlang\/agon\/py\/agon-tui-probe\.py$/);
    expect(existsSync(script as string)).toBe(true);
  });

  // Full end-to-end spawn of a throwaway agon (~3s, needs built dist + python3
  // + pyte). Gated so CI/unit runs stay fast and deterministic; run with
  // AGON_TUI_E2E=1 locally or in the gate.
  it.runIf(process.env.AGON_TUI_E2E === '1')(
    'end-to-end: returns the final pyte frame containing the ChromeBar',
    async () => {
      const tool = createTuiProbeTool();
      const result = await tool.execute({ input: '/help', timeoutSec: 40 }, ctx);
      expect(result.ok).toBe(true);
      expect(result.content).toContain('AGON');
    },
    70000,
  );
});
