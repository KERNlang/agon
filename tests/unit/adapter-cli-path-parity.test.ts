import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Two adapter findings, both on the direct-CLI-spawn paths:
//
// 1. dispatchAgentStream's CLI branch ignored options.systemPrompt and skipped
//    checkEnvVars, while dispatch / dispatchStream / dispatchAgent all honor
//    both. A caller's system prompt vanished purely because the dispatch
//    streamed, and a present binary with an unset required env var reached the
//    spawn instead of failing loudly. These assert PARITY with the
//    non-streaming dispatchAgent, so the two paths can't drift apart again.
//
// 2. getVersion returned the API model id whenever engine.api existed, even for
//    a dual-mode engine whose CLI binary is installed and is therefore the
//    backend that will actually run. Binary first, api as the fallback.
//
// spawnStream / spawnWithTimeout are stubbed via the @kernlang/agon-core mock so
// the assembled command + args are observable without running a real engine.
const spawnState = {
  streamCalls: 0,
  streamCommand: '',
  streamArgs: [] as string[],
  syncCalls: 0,
  syncCommand: '',
  syncArgs: [] as string[],
  syncStdout: 'cli-output',
};

vi.mock('@kernlang/agon-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kernlang/agon-core')>();
  return {
    ...actual,
    // Keep the agent diff capture off real git — these tests are about args.
    readOnlyDiff: () => '',
    spawnStream: async function* (opts: { command: string; args: string[] }) {
      spawnState.streamCalls += 1;
      spawnState.streamCommand = opts.command;
      spawnState.streamArgs = opts.args;
      yield 'chunk';
      return { exitCode: 0, stdout: 'cli-agent-stream-output', stderr: '', durationMs: 1, timedOut: false };
    },
    spawnWithTimeout: async (opts: { command: string; args: string[] }) => {
      spawnState.syncCalls += 1;
      spawnState.syncCommand = opts.command;
      spawnState.syncArgs = opts.args;
      return { exitCode: 0, stdout: spawnState.syncStdout, stderr: '', durationMs: 1, timedOut: false };
    },
  };
});

import { CliAdapter } from '../../packages/adapter-cli/src/adapter.js';
import { EngineRegistry, EngineNotFoundError } from '@kernlang/agon-core';
import type { EngineDefinition, DispatchOptions, AgentDispatchResult } from '@kernlang/agon-core';

const REQUIRED_VAR = 'AGON_ADAPTER_PARITY_REQUIRED_VAR';

// process.execPath is an absolute path to a real executable, so findBinary
// resolves it without depending on anything being installed on PATH.
function cliEngine(id: string, extra: Record<string, unknown> = {}): EngineDefinition {
  return {
    schemaVersion: 3,
    id,
    displayName: id,
    isLocal: false,
    tier: 'builtin',
    binary: process.execPath,
    timeout: 60,
    agent: { args: ['--go', '{prompt}'] },
    exec: { args: ['--go', '{prompt}'] },
    ...extra,
  } as unknown as EngineDefinition;
}

const PREPEND_ENGINE = cliEngine('parity-prepend');
const FLAG_ENGINE = cliEngine('parity-flag', { systemPromptFlag: '--system' });
const ENV_ENGINE = cliEngine('parity-env', { env: { [REQUIRED_VAR]: { required: true, description: 'test' } } });

function makeAdapter(): CliAdapter {
  return new CliAdapter(new EngineRegistry());
}

function makeOptions(engine: EngineDefinition, systemPrompt?: string): DispatchOptions {
  return {
    engine,
    prompt: 'hello',
    cwd: process.cwd(),
    mode: 'agent',
    timeout: 60,
    outputDir: mkdtempSync(join(tmpdir(), 'adapter-parity-')),
    ...(systemPrompt ? { systemPrompt } : {}),
  } as DispatchOptions;
}

async function drain(
  gen: AsyncGenerator<string, AgentDispatchResult, void>,
): Promise<{ chunks: string[]; result: AgentDispatchResult }> {
  const chunks: string[] = [];
  while (true) {
    const next = await gen.next();
    if (next.done) return { chunks, result: next.value };
    chunks.push(next.value);
  }
}

beforeEach(() => {
  spawnState.streamCalls = 0;
  spawnState.streamCommand = '';
  spawnState.streamArgs = [];
  spawnState.syncCalls = 0;
  spawnState.syncCommand = '';
  spawnState.syncArgs = [];
  spawnState.syncStdout = 'cli-output';
  delete process.env[REQUIRED_VAR];
});

afterEach(() => {
  delete process.env[REQUIRED_VAR];
});

describe('CliAdapter.dispatchAgentStream — CLI path parity with dispatchAgent', () => {
  it('prepends the system prompt when the engine has no native flag', async () => {
    process.env[REQUIRED_VAR] = 'set';
    await drain(makeAdapter().dispatchAgentStream(makeOptions(PREPEND_ENGINE, 'BE TERSE')));

    expect(spawnState.streamCalls).toBe(1);
    const prompt = spawnState.streamArgs[spawnState.streamArgs.indexOf('--go') + 1];
    expect(prompt).toBe('[System Instructions]\nBE TERSE\n\n[User Message]\nhello');
    // No native flag exists, so none may be injected.
    expect(spawnState.streamArgs).not.toContain('--system');
  });

  it('injects the native system-prompt flag immediately before the prompt', async () => {
    await drain(makeAdapter().dispatchAgentStream(makeOptions(FLAG_ENGINE, 'BE TERSE')));

    const flagIdx = spawnState.streamArgs.indexOf('--system');
    expect(flagIdx).toBeGreaterThanOrEqual(0);
    expect(spawnState.streamArgs[flagIdx + 1]).toBe('BE TERSE');
    // Native flag path leaves the user prompt untouched — no prepend.
    expect(spawnState.streamArgs[flagIdx + 2]).toBe('hello');
  });

  it('produces byte-identical args to dispatchAgent for the same options', async () => {
    const adapter = makeAdapter();
    await drain(adapter.dispatchAgentStream(makeOptions(FLAG_ENGINE, 'BE TERSE')));
    await adapter.dispatchAgent(makeOptions(FLAG_ENGINE, 'BE TERSE'));

    expect(spawnState.streamArgs).toEqual(spawnState.syncArgs);
    expect(spawnState.streamCommand).toBe(spawnState.syncCommand);
  });

  it('leaves the prompt untouched when no system prompt is supplied', async () => {
    await drain(makeAdapter().dispatchAgentStream(makeOptions(PREPEND_ENGINE)));

    expect(spawnState.streamArgs).toEqual(['--go', 'hello']);
  });

  it('throws for a missing required env var instead of spawning the engine', async () => {
    const gen = makeAdapter().dispatchAgentStream(makeOptions(ENV_ENGINE, 'BE TERSE'));

    await expect(gen.next()).rejects.toThrow(EngineNotFoundError);
    await expect(makeAdapter().dispatchAgentStream(makeOptions(ENV_ENGINE)).next())
      .rejects.toThrow(REQUIRED_VAR);
    expect(spawnState.streamCalls).toBe(0);
  });

  it('spawns once the required env var is set', async () => {
    process.env[REQUIRED_VAR] = 'present';
    await drain(makeAdapter().dispatchAgentStream(makeOptions(ENV_ENGINE)));

    expect(spawnState.streamCalls).toBe(1);
  });
});

describe('CliAdapter.getVersion — installed binary wins over the API model', () => {
  const DUAL_MODE = cliEngine('parity-dual', {
    versionCmd: ['--version'],
    api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'PARITY_DUAL_KEY', model: 'dual-model', format: 'openai' },
  });

  it('reports the binary version for a dual-mode engine whose CLI is installed', async () => {
    spawnState.syncStdout = 'v99.1.2\n';
    const version = await makeAdapter().getVersion(DUAL_MODE);

    expect(version).toBe('v99.1.2');
    expect(spawnState.syncCommand).toBe(process.execPath);
    expect(spawnState.syncArgs).toEqual(['--version']);
    expect(version).not.toBe('dual-model');
  });

  it('falls back to the API model when the engine has no CLI binary', async () => {
    const apiOnly = {
      schemaVersion: 3,
      id: 'parity-api-only',
      displayName: 'parity-api-only',
      timeout: 60,
      api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'PARITY_API_KEY', model: 'api-only-model', format: 'openai' },
    } as unknown as EngineDefinition;

    expect(await makeAdapter().getVersion(apiOnly)).toBe('api-only-model');
    expect(spawnState.syncCalls).toBe(0);
  });

  it('falls back to the API model when the binary reports no usable version', async () => {
    spawnState.syncStdout = '   \n';
    expect(await makeAdapter().getVersion(cliEngine('parity-blank', {
      versionCmd: ['--version'],
      api: { baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'PARITY_BLANK_KEY', model: 'blank-model', format: 'openai' },
    }))).toBe('blank-model');
  });

  it('returns null for a CLI-only engine with no versionCmd', async () => {
    expect(await makeAdapter().getVersion(cliEngine('parity-noversioncmd'))).toBeNull();
    expect(spawnState.syncCalls).toBe(0);
  });
});
