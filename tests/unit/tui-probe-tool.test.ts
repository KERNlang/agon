import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fileURLToPath } from 'node:url';
import * as core from '@kernlang/agon-core';

const assets = vi.hoisted(() => ({ missing: false }));
vi.mock('@kernlang/agon-support-verification', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kernlang/agon-support-verification')>();
  return {
    ...actual,
    resolveTuiProbeScript: () => assets.missing ? null : actual.resolveTuiProbeScript(),
  };
});
import {
  TUI_PROBE_INPUT_SAFELIST,
  createTuiProbeTool,
  resolveTuiProbePaths,
} from '../../packages/cli/src/cesar/tool-tui-probe.js';

const ctx = {} as never;
afterEach(() => { assets.missing = false; vi.restoreAllMocks(); });

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

  it('resolves the owned script while retaining the CLI binary', () => {
    const { script, agonBin } = resolveTuiProbePaths();
    expect(script).toBe(fileURLToPath(new URL('../../packages/support-verification/python/agon-tui-probe.py', import.meta.url)));
    expect(agonBin).toBe(fileURLToPath(new URL('../../packages/cli/dist/index.js', import.meta.url)));
    expect(existsSync(script as string)).toBe(true);
  });

  it('retains the legacy CLI script fallback when the owned asset is unavailable', () => {
    assets.missing = true;
    const { script } = resolveTuiProbePaths();
    expect(script).toBeTruthy();
    expect(script).toMatch(/packages\/cli\/py\/agon-tui-probe\.py$|@kernlang\/agon\/py\/agon-tui-probe\.py$/);
    expect(existsSync(script as string)).toBe(true);
  });

  it.each([false, true])('passes the CLI binary explicitly with legacy fallback %s', async (missing) => {
    assets.missing = missing;
    const { script, agonBin } = resolveTuiProbePaths();
    const spawn = vi.spyOn(core, 'spawnWithTimeout').mockResolvedValue({
      exitCode: 0, stdout: JSON.stringify({ frame: 'fixture frame', durationMs: 1 }),
      stderr: '', durationMs: 1, timedOut: false,
    });

    const result = await createTuiProbeTool().execute({ input: '/help', cols: 100, rows: 30, timeoutSec: 12 }, ctx);

    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      command: 'python3',
      args: [script, '--input', '/help', '--cols', '100', '--rows', '30', '--timeout', '12', '--agon-bin', agonBin],
      timeout: 27000,
    }));
    expect(result.ok).toBe(true);
    expect(result.content).toContain('fixture frame');
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
