import { mkdtempSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const stream = vi.hoisted(() => vi.fn());
vi.mock('../../packages/core/src/api/dispatch.js', () => ({ apiStreamDispatchWithHistory: stream }));
import { runApiAgentLoop } from '../../packages/core/src/api/agent-loop.js';

let cwd: string;
beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), 'agon-api-authority-')); stream.mockReset(); });
afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

it.each(['permanent', 'throw', 'factory-throw', 'transient', 'empty', 'reasoning'])(
  'checks authority before classifying a settled provider: %s', async outcome => {
    let refused = false;
    const history = vi.fn();
    stream.mockImplementation(() => {
      if (outcome === 'factory-throw') { refused = true; throw new Error('provider failure'); }
      return (async function* () {
        refused = true;
        if (outcome === 'throw') throw new Error('provider failure');
        if (outcome === 'permanent') return { exitCode: 1, stderr: '401 unauthorized' };
        if (outcome === 'transient') return { exitCode: 1, stderr: '503 overloaded' };
        return { exitCode: 0, parts: outcome === 'reasoning' ? [{ kind: 'reasoning', text: 'hidden' }] : [] };
      })();
    });
    const result = await runApiAgentLoop({
      api: { baseUrl: 'https://example.invalid', apiKeyEnv: 'UNUSED_FIXTURE_KEY', model: 'fixture' },
      prompt: 'fixture', cwd, timeout: 30, maxDispatchRetries: 0,
      executionRefusal: () => refused ? 'Owner disabled' : undefined,
      onHistoryEntry: history,
    });
    expect(result).toMatchObject({ failed: true, errorReason: 'Owner disabled', toolCalls: 0 });
    expect(result.engineFault).not.toBe(true);
    expect(history).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalledOnce();
  },
);

it.each(['before dispatch', 'provider return', 'approval'])(
  'preserves cancellation when authority also refuses: %s', async boundary => {
    const abort = new AbortController();
    let refused = false;
    const revoke = () => { refused = true; abort.abort(); };
    const workspace = join(cwd, 'workspace');
    mkdirSync(workspace);
    if (boundary === 'before dispatch') revoke();
    stream.mockImplementation(async function* () {
      if (boundary === 'provider return') revoke();
      yield boundary === 'approval'
        ? '<tool name="Write">{"file_path":"../result.txt","content":"fixture"}</tool>' : 'done';
      return { exitCode: 0 };
    });
    const result = await runApiAgentLoop({
      api: { baseUrl: 'https://example.invalid', apiKeyEnv: 'UNUSED_FIXTURE_KEY', model: 'fixture' },
      prompt: 'fixture', cwd: workspace, timeout: 30, maxSteps: 1, signal: abort.signal,
      executionRefusal: () => refused ? 'Owner disabled' : undefined,
      permissionMode: 'ask', toolPermissions: { Write: 'ask' },
      onPermissionAsk: async () => { revoke(); return true; },
    });
    expect(result.cancelled).toBe(true);
    expect(result.engineFault).not.toBe(true);
    expect(existsSync(join(cwd, 'result.txt'))).toBe(false);
    expect(stream).toHaveBeenCalledTimes(boundary === 'before dispatch' ? 0 : 1);
  },
);

it('rejects a successful provider return after cancellation without an authority hook', async () => {
  const abort = new AbortController();
  stream.mockImplementation(async function* () { abort.abort(); yield 'done'; return { exitCode: 0 }; });
  const result = await runApiAgentLoop({
    api: { baseUrl: 'https://example.invalid', apiKeyEnv: 'UNUSED_FIXTURE_KEY', model: 'fixture' },
    prompt: 'fixture', cwd, timeout: 30, signal: abort.signal,
  });
  expect(result.cancelled).toBe(true);
  expect(result.engineFault).not.toBe(true);
});

it.each(['empty', 'throws'])('refuses malformed authority outcome before a provider call: %s', async fault => {
  stream.mockImplementation(async function* () { yield 'unexpected provider answer'; return { exitCode: 0 }; });
  const result = await runApiAgentLoop({
    api: { baseUrl: 'https://example.invalid', apiKeyEnv: 'UNUSED_FIXTURE_KEY', model: 'fixture' },
    prompt: 'fixture', cwd, timeout: 30,
    executionRefusal: () => { if (fault === 'throws') throw new Error('private fixture detail'); return ''; },
  });
  expect(stream).not.toHaveBeenCalled();
  expect(result.failed).toBe(true);
  expect(result.errorReason).toBeTruthy();
  expect(result.errorReason).not.toContain('private fixture detail');
});

it.each(['enabled', 'before dispatch', 'before tool', 'during approval', 'last-step approval', 'before retry'] as const)(
  'honors execution authority: %s', async scenario => {
    let refused = scenario === 'before dispatch';
    const approval = scenario === 'during approval' || scenario === 'last-step approval';
    const workspace = approval ? join(cwd, 'workspace') : cwd;
    mkdirSync(workspace, { recursive: true });
    const refusal = 'fixture owner disabled';
    let calls = 0;
    stream.mockImplementation(async function* () {
      calls++;
      if (scenario === 'before retry' && calls === 1) {
        refused = true;
        return { exitCode: 1, stderr: '503 overloaded', stdout: '' };
      }
      if (calls === 1) {
        if (scenario === 'before tool') refused = true;
        yield `<tool name="Write">${JSON.stringify({ file_path: approval ? '../result.txt' : 'result.txt', content: 'fixture' })}</tool>`;
      } else yield 'done';
      return { exitCode: 0, stderr: '', stdout: '' };
    });
    const approve = vi.fn(async () => { refused = true; return true; });
    const result = await runApiAgentLoop({
      api: { baseUrl: 'https://example.invalid', apiKeyEnv: 'UNUSED_FIXTURE_KEY', model: 'fixture' },
      prompt: 'write fixture', cwd: workspace, timeout: 30, maxSteps: scenario === 'last-step approval' ? 1 : 3, retryBaseMs: 0,
      permissionMode: approval ? 'ask' : 'auto',
      toolPermissions: approval ? { Write: 'ask' } : {},
      onPermissionAsk: approve,
      ...{ executionRefusal: () => refused ? refusal : undefined },
    });
    expect(existsSync(join(cwd, 'result.txt'))).toBe(scenario === 'enabled');
    expect(stream).toHaveBeenCalledTimes(scenario === 'enabled' ? 2 : scenario === 'before dispatch' ? 0 : 1);
    if (scenario === 'enabled') expect(result.response).toBe('done');
    else expect(result).toMatchObject({ failed: true, errorReason: refusal });
    expect(approve).toHaveBeenCalledTimes(approval ? 1 : 0);
  },
);
