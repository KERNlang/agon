import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock ONLY the config I/O (transitively used by the permission resolver) so
// gateAutoRunPermitted never reads the developer's real ~/.agon/config.json.
const { loadConfigMock, configSetMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn().mockReturnValue({}),
  configSetMock: vi.fn(),
}));
vi.mock('@kernlang/agon-core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@kernlang/agon-core');
  return { ...actual, loadConfig: loadConfigMock, configSet: configSetMock };
});

import {
  buildGateFailureMessage,
  buildGateSuccessNote,
  gateAutoRunLimit,
  gateAutoRunPermitted,
  gateOutputTailChars,
  gateTimeoutMs,
  runDiscoveredGate,
  shouldAutoRunGate,
  type GateRunResult,
} from '../../packages/cli/src/generated/cesar/gate-runner.js';
import { clearSessionPermissionRules } from '../../packages/cli/src/generated/cesar/permission-resolver.js';

const WS = process.cwd();

const gate = (overrides: Record<string, unknown> = {}) => ({
  command: 'npm test',
  matchers: ['npm test', 'vitest'],
  source: 'package-scripts' as const,
  ...overrides,
});

const snapshot = (overrides: Record<string, unknown> = {}) => ({
  gate: gate(),
  config: {},
  waived: false,
  alreadyVerified: false,
  wroteWork: true,
  runsSoFar: 0,
  permitted: true,
  ...overrides,
});

beforeEach(() => {
  clearSessionPermissionRules();
  loadConfigMock.mockReturnValue({});
  configSetMock.mockClear();
});

describe('shouldAutoRunGate', () => {
  it('allows the canonical case: gate present, write-work, permitted, first run', () => {
    expect(shouldAutoRunGate(snapshot())).toBe(true);
  });

  it('is off when cesarGateAutoRun is false', () => {
    expect(shouldAutoRunGate(snapshot({ config: { cesarGateAutoRun: false } }))).toBe(false);
  });

  it('requires a discovered gate command', () => {
    expect(shouldAutoRunGate(snapshot({ gate: gate({ command: '' }) }))).toBe(false);
    expect(shouldAutoRunGate(snapshot({ gate: undefined }))).toBe(false);
  });

  it('requires gate matchers so the run can be recognized by the bookkeeping', () => {
    expect(shouldAutoRunGate(snapshot({ gate: gate({ matchers: [] }) }))).toBe(false);
  });

  it('respects the session waiver', () => {
    expect(shouldAutoRunGate(snapshot({ waived: true }))).toBe(false);
  });

  it('never re-runs a turn that is already verified', () => {
    expect(shouldAutoRunGate(snapshot({ alreadyVerified: true }))).toBe(false);
  });

  it('only fires after real write-work', () => {
    expect(shouldAutoRunGate(snapshot({ wroteWork: false }))).toBe(false);
  });

  it('caps runs per turn at cesarGateAutoRunLimit (default 3)', () => {
    expect(shouldAutoRunGate(snapshot({ runsSoFar: 2 }))).toBe(true);
    expect(shouldAutoRunGate(snapshot({ runsSoFar: 3 }))).toBe(false);
    expect(shouldAutoRunGate(snapshot({ runsSoFar: 1, config: { cesarGateAutoRunLimit: 1 } }))).toBe(false);
  });

  it('requires the permission posture to already allow the command', () => {
    expect(shouldAutoRunGate(snapshot({ permitted: false }))).toBe(false);
  });
});

describe('config tunables', () => {
  it('gateAutoRunLimit defaults to 3 and clamps to [0,10]', () => {
    expect(gateAutoRunLimit({})).toBe(3);
    expect(gateAutoRunLimit({ cesarGateAutoRunLimit: 0 })).toBe(0);
    expect(gateAutoRunLimit({ cesarGateAutoRunLimit: 99 })).toBe(10);
    expect(gateAutoRunLimit({ cesarGateAutoRunLimit: Number.NaN })).toBe(3);
    expect(gateAutoRunLimit(undefined)).toBe(3);
  });

  it('gateTimeoutMs defaults to 300s and caps at 3600s', () => {
    expect(gateTimeoutMs({})).toBe(300_000);
    expect(gateTimeoutMs({ cesarGateTimeoutSec: 10 })).toBe(10_000);
    expect(gateTimeoutMs({ cesarGateTimeoutSec: 7200 })).toBe(3_600_000);
    expect(gateTimeoutMs({ cesarGateTimeoutSec: 0 })).toBe(300_000);
    expect(gateTimeoutMs({ cesarGateTimeoutSec: -5 })).toBe(300_000);
  });

  it('gateOutputTailChars defaults to 2000 and clamps to [200,20000]', () => {
    expect(gateOutputTailChars({})).toBe(2000);
    expect(gateOutputTailChars({ cesarGateOutputTailChars: 50 })).toBe(200);
    expect(gateOutputTailChars({ cesarGateOutputTailChars: 100_000 })).toBe(20_000);
  });
});

describe('gateAutoRunPermitted', () => {
  it('allows a routine gate command in mode auto', () => {
    expect(gateAutoRunPermitted('npm test', WS, { agonPermissionMode: 'auto' })).toBe(true);
    expect(gateAutoRunPermitted('npm run typecheck', WS, { agonPermissionMode: 'auto' })).toBe(true);
  });

  it('a read-only-classified gate (npm test) is allowed in every mode — resolver read-only Bash policy', () => {
    expect(gateAutoRunPermitted('npm test', WS, { agonPermissionMode: 'ask' })).toBe(true);
    expect(gateAutoRunPermitted('npm test', WS, { agonPermissionMode: 'auto-edit' })).toBe(true);
  });

  it('a mutating-classified gate does not run in ask mode without a covering rule', () => {
    expect(gateAutoRunPermitted('npm run typecheck', WS, { agonPermissionMode: 'ask' })).toBe(false);
  });

  it('a mutating-classified gate does not run in auto-edit mode without a covering rule', () => {
    expect(gateAutoRunPermitted('npm run typecheck', WS, { agonPermissionMode: 'auto-edit' })).toBe(false);
  });

  it('a persisted allow rule (the Always artifact) enables the run in any mode', () => {
    const config = { agonPermissionMode: 'ask', permissions: { allow: ['Bash(npm run typecheck:*)'], deny: [] } };
    expect(gateAutoRunPermitted('npm run typecheck', WS, config)).toBe(true);
  });

  it('a gate command that trips a dangerous boundary is refused even in auto mode', () => {
    expect(gateAutoRunPermitted('npm run deploy:production', WS, { agonPermissionMode: 'auto' })).toBe(false);
  });

  it('a deny rule wins over mode auto', () => {
    const config = { agonPermissionMode: 'auto', permissions: { allow: [], deny: ['Bash(npm test:*)'] } };
    expect(gateAutoRunPermitted('npm test', WS, config)).toBe(false);
  });
});

describe('runDiscoveredGate', () => {
  it('reports a passing gate', async () => {
    const result = await runDiscoveredGate({ command: 'exit 0', cwd: WS, timeoutMs: 10_000, tailChars: 2000 });
    expect(result.ok).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('reports a failing gate with the real exit code and stderr tail', async () => {
    const result = await runDiscoveredGate({ command: 'echo boom >&2; exit 3', cwd: WS, timeoutMs: 10_000, tailChars: 2000 });
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(3);
    expect(result.outputTail).toContain('boom');
  });

  it('times out a hung gate', async () => {
    const result = await runDiscoveredGate({ command: 'sleep 5', cwd: WS, timeoutMs: 250, tailChars: 2000 });
    expect(result.ok).toBe(false);
    expect(result.timedOut).toBe(true);
  }, 15_000);

  it('tail-caps long output', async () => {
    const result = await runDiscoveredGate({
      command: 'node -e "process.stdout.write(\'x\'.repeat(5000) + \'TAILEND\')"; exit 1',
      cwd: WS,
      timeoutMs: 15_000,
      tailChars: 300,
    });
    expect(result.outputTail.startsWith('…')).toBe(true);
    expect(result.outputTail.length).toBeLessThanOrEqual(301);
    expect(result.outputTail).toContain('TAILEND');
  }, 20_000);

  it('returns a failed result on a pre-aborted signal instead of throwing', async () => {
    const controller = new AbortController();
    controller.abort();
    const result = await runDiscoveredGate({ command: 'exit 0', cwd: WS, timeoutMs: 5_000, tailChars: 2000, signal: controller.signal });
    expect(result.ok).toBe(false);
  });
});

describe('gate messages', () => {
  const failed: GateRunResult = { ok: false, exitCode: 2, outputTail: 'FAIL src/x.test.ts', durationMs: 4200, timedOut: false };

  it('failure message carries the command, exit code, and output tail', () => {
    const msg = buildGateFailureMessage(failed, 'npm test');
    expect(msg).toContain('[SYSTEM]');
    expect(msg).toContain('npm test');
    expect(msg).toContain('exit 2');
    expect(msg).toContain('FAIL src/x.test.ts');
  });

  it('timeout failures say so explicitly', () => {
    const msg = buildGateFailureMessage({ ...failed, timedOut: true, durationMs: 300_000 }, 'npm test');
    expect(msg).toContain('TIMED OUT');
  });

  it('success note names the command', () => {
    expect(buildGateSuccessNote({ ok: true, exitCode: 0, outputTail: '', durationMs: 2100, timedOut: false }, 'npm test')).toContain('npm test');
  });
});
