import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiCalls: Array<{ model: string }> = [];

vi.mock('@kernlang/agon-core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kernlang/agon-core')>();
  return {
    ...actual,
    apiDispatch: async (config: { model: string }) => {
      apiCalls.push({ model: config.model });
      return { exitCode: 0, stdout: 'api-answer', stderr: '', durationMs: 1, timedOut: false };
    },
  };
});

import { EngineRegistry } from '@kernlang/agon-core';
import type { DispatchResult, EngineDefinition } from '@kernlang/agon-core';
import { CliAdapter } from '../../packages/adapter-cli/src/adapter.js';
import { resolveEngineIdentity } from '../../packages/adapter-cli/src/engine-identity.js';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

const agyJson = JSON.parse(readFileSync(new URL('../../engines/agy.json', import.meta.url), 'utf-8')) as EngineDefinition;

let home: string;
let dir: string;
const savedEnv = { GOOGLE_API_KEY: process.env.GOOGLE_API_KEY, CODEX_MODEL: process.env.CODEX_MODEL };

beforeEach(() => {
  home = setupTestAgonHome('engine-identity');
  dir = mkdtempSync(join(tmpdir(), 'agon-engine-identity-'));
  apiCalls.length = 0;
  delete process.env.GOOGLE_API_KEY;
  delete process.env.CODEX_MODEL;
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  cleanupTestAgonHome(home);
  rmSync(dir, { recursive: true, force: true });
});

function fakeBinary(name: string, versionScript: string): string {
  const path = join(dir, name);
  writeFileSync(path, `#!/bin/sh\nif [ "$1" = "--version" ]; then\n${versionScript}\nfi\necho answer\n`);
  chmodSync(path, 0o755);
  return path;
}

function configure(config: Record<string, unknown>): void {
  writeFileSync(join(home, 'config.json'), JSON.stringify(config));
}

async function dispatchWith(engine: EngineDefinition): Promise<DispatchResult & { identity?: string | null }> {
  const registry = new EngineRegistry();
  registry.register(engine);
  const outputDir = join(dir, 'out');
  mkdirSync(outputDir, { recursive: true });
  return new CliAdapter(registry).dispatch({ engine, prompt: 'hi', cwd: dir, mode: 'exec', timeout: 10, outputDir });
}

describe('engine identity from the backend the dispatch used', () => {
  it('AC-9 agy has no model block: on the CLI backend its identity is the CLI version, never engineModels.agy', async () => {
    configure({ engineModels: { agy: 'gemini-3.6-flash' } });
    const agy = { ...agyJson, binary: fakeBinary('agy', '  echo "1.4.2"\n  exit 0'), searchPaths: [] };
    const result = await dispatchWith(agy);
    expect(result.stdout.trim()).toBe('answer');
    expect(result.identity).toBe('cli:1.4.2');
  });

  it('AC-9 agy with its binary missing and GOOGLE_API_KEY set runs on the API backend and reports its api model', async () => {
    configure({ engineModels: { agy: 'gemini-3.6-flash' } });
    process.env.GOOGLE_API_KEY = 'test-key';
    const agy = { ...agyJson, binary: join(dir, 'missing', 'agy'), searchPaths: [] };
    const result = await dispatchWith(agy);
    expect(apiCalls).toEqual([{ model: 'gemini-3.1-pro' }]);
    expect(result.identity).toBe('api:gemini-3.1-pro');
  });

  it('AC-9 a model env override wins over engineModels on the CLI backend', async () => {
    configure({ engineModels: { codexish: 'gpt-config' } });
    process.env.CODEX_MODEL = 'gpt-env';
    const codexish = {
      schemaVersion: 3, id: 'codexish', displayName: 'Codexish', isLocal: false, tier: 'user', timeout: 10,
      binary: fakeBinary('codexish', '  echo "9.9.9"\n  exit 0'), versionCmd: ['--version'],
      model: { configKey: 'codex_model', flag: '--model' }, exec: { args: ['exec', '{prompt}'] },
    } as EngineDefinition;
    const result = await dispatchWith(codexish);
    expect(result.identity).toBe('gpt-env');
  });

  it('AC-9 a hung versionCmd resolves to null within the version timeout', async () => {
    const binaryPath = fakeBinary('hangs', '  sleep 30');
    const def = { ...agyJson, binary: binaryPath, searchPaths: [] };
    const started = Date.now();
    const identity = await resolveEngineIdentity(def, dir, { backend: 'cli', binaryPath }, { versionTimeoutMs: 300 });
    expect(identity).toBeNull();
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('AC-9 a failing versionCmd or a missing backend is null', async () => {
    const failing = fakeBinary('fails', '  exit 3');
    expect(await resolveEngineIdentity({ ...agyJson, binary: failing }, dir, { backend: 'cli', binaryPath: failing })).toBeNull();
    expect(await resolveEngineIdentity(agyJson, dir, { backend: 'missing', binaryPath: null })).toBeNull();
  });

  it('AC-9 a versionCmd that prints a version but exits non-zero is null', async () => {
    const binaryPath = fakeBinary('prints-then-fails', '  echo "3.1.4"\n  exit 3');
    expect(await resolveEngineIdentity({ ...agyJson, binary: binaryPath }, dir, { backend: 'cli', binaryPath })).toBeNull();
  });

  it('AC-9 a versionCmd that prints a version, then times out and exits 0 on SIGTERM, is null', async () => {
    const binaryPath = fakeBinary('prints-then-hangs', "  trap 'exit 0' TERM\n  echo \"2.7.1\"\n  sleep 30 &\n  wait $!");
    const started = Date.now();
    expect(await resolveEngineIdentity({ ...agyJson, binary: binaryPath }, dir, { backend: 'cli', binaryPath }, { versionTimeoutMs: 300 })).toBeNull();
    expect(Date.now() - started).toBeLessThan(5000);
  });

  it('AC-9 fetches the CLI version once per process', async () => {
    const counter = join(dir, 'version-calls');
    const agy = { ...agyJson, binary: fakeBinary('agy-counted', `  echo x >> "${counter}"\n  echo "2.0.0"\n  exit 0`), searchPaths: [] };
    const first = await dispatchWith(agy);
    const second = await dispatchWith(agy);
    expect([first.identity, second.identity]).toEqual(['cli:2.0.0', 'cli:2.0.0']);
    expect(existsSync(counter) ? readFileSync(counter, 'utf-8').trim().split('\n') : []).toHaveLength(1);
  });
});
