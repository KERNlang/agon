import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Finding 1: when a declared CLI binary is off PATH, the API fallback must only be
// taken when a usable API key is actually present. binary-missing + NO key must
// throw EngineNotFoundError naming the binary (the codex incident) — NOT mis-report
// as "Missing API key" — while binary-missing + a valid key still uses the api fallback.
//
// We stub apiDispatch via the @kernlang/agon-core mock so the key-SET path is
// observable without a real network call; everything else stays real.
const mockState = {
  apiCalled: false,
};

vi.mock('@kernlang/agon-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kernlang/agon-core')>();
  return {
    ...actual,
    apiDispatch: async () => {
      mockState.apiCalled = true;
      return { exitCode: 0, stdout: 'api-fallback-output', stderr: '', durationMs: 1, timedOut: false };
    },
  };
});

import { CliAdapter } from '../../packages/adapter-cli/src/generated/adapter.js';
import { EngineRegistry, EngineNotFoundError } from '@kernlang/agon-core';
import type { EngineDefinition, DispatchOptions } from '@kernlang/agon-core';

// An engine that declares BOTH a (non-resolvable) CLI binary and an api block —
// exactly the shape of codex/claude/agy. The binary name is chosen so `which`
// never resolves it, forcing the binary-missing path deterministically.
const ENGINE: EngineDefinition = {
  id: 'finding1-fixture',
  binary: 'agon-nonexistent-binary-xyz',
  installHint: 'install the thing',
  timeout: 60,
  exec: { args: [] },
  review: { args: [] },
  api: {
    baseUrl: 'https://example.invalid/v1',
    apiKeyEnv: 'FINDING1_FIXTURE_KEY',
    model: 'fixture-model',
    format: 'openai',
  },
} as unknown as EngineDefinition;

function makeAdapter(): CliAdapter {
  return new CliAdapter(new EngineRegistry());
}

function makeOptions(): DispatchOptions {
  return {
    engine: ENGINE,
    prompt: 'hello',
    cwd: process.cwd(),
    mode: 'exec',
    timeout: 60,
    outputDir: mkdtempSync(join(tmpdir(), 'finding1-')),
  } as DispatchOptions;
}

describe('CliAdapter.dispatch — api fallback gated on key presence (Finding 1)', () => {
  beforeEach(() => {
    mockState.apiCalled = false;
    delete process.env.FINDING1_FIXTURE_KEY;
    delete process.env.undefined;
  });

  it('binary missing + key UNSET → throws EngineNotFoundError naming the binary (not "Missing API key")', async () => {
    const adapter = makeAdapter();
    await expect(adapter.dispatch(makeOptions())).rejects.toThrow(EngineNotFoundError);
    try {
      await adapter.dispatch(makeOptions());
      throw new Error('expected throw');
    } catch (e) {
      const err = e as EngineNotFoundError;
      expect(err.message).toContain('binary "agon-nonexistent-binary-xyz" not found on PATH');
      expect(err.message).toContain('Install: install the thing');
      // Must NOT look like an env / API-key problem.
      expect(err.message).not.toContain('API key');
      expect(err.message).not.toContain('environment variable');
      expect((err as EngineNotFoundError).missingBinary).toBe('agon-nonexistent-binary-xyz');
    }
    // The api fallback must NOT have been reached.
    expect(mockState.apiCalled).toBe(false);
  });

  it('binary missing + key SET → takes the api fallback (preserves the feature)', async () => {
    process.env.FINDING1_FIXTURE_KEY = 'sk-test-123';
    const adapter = makeAdapter();
    const result = await adapter.dispatch(makeOptions());
    expect(mockState.apiCalled).toBe(true);
    expect(result.stdout).toBe('api-fallback-output');
  });

  it('binary-only engine (no api block) + binary missing → still throws EngineNotFoundError (unchanged)', async () => {
    const binaryOnly = { ...ENGINE, api: undefined } as unknown as EngineDefinition;
    const adapter = makeAdapter();
    const opts = { ...makeOptions(), engine: binaryOnly } as DispatchOptions;
    await expect(adapter.dispatch(opts)).rejects.toThrow(EngineNotFoundError);
    expect(mockState.apiCalled).toBe(false);
  });

  it('malformed apiKeyEnv cannot enable streaming fallbacks through process.env.undefined', async () => {
    process.env.undefined = 'must-not-count-as-an-api-key';
    const malformed = {
      ...ENGINE,
      api: { ...ENGINE.api, apiKeyEnv: undefined },
    } as unknown as EngineDefinition;
    const options = { ...makeOptions(), engine: malformed } as DispatchOptions;
    const adapter = makeAdapter();

    await expect(adapter.dispatchStream(options).next()).rejects.toThrow(EngineNotFoundError);
    await expect(adapter.dispatchAgentStream(options).next()).rejects.toThrow(EngineNotFoundError);
    expect(mockState.apiCalled).toBe(false);
  });
});
