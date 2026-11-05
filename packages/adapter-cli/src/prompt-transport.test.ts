import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EngineDefinition, EngineRegistry } from '@kernlang/agon-core';
import { CliAdapter } from './adapter.js';

const TWO_MB = 'x'.repeat(2_000_000);

describe('huge prompts reach the engine or fail by name', () => {
  const savedHome = process.env.AGON_HOME;
  let dir: string;
  let script: string;
  let ranMarker: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'agon-transport-'));
    process.env.AGON_HOME = join(dir, 'home');
    ranMarker = join(dir, 'ran');
    script = join(dir, 'fake-engine');
    writeFileSync(script, `#!/bin/sh\ntouch "${ranMarker}"\necho "stdin=$(wc -c | tr -d ' ')"\n`);
    chmodSync(script, 0o755);
  });
  afterAll(() => {
    if (savedHome === undefined) delete process.env.AGON_HOME;
    else process.env.AGON_HOME = savedHome;
  });

  const engine = (stdin?: boolean): EngineDefinition => ({
    schemaVersion: 3, id: 'fake-engine', displayName: 'Fake', binary: 'fake-engine', isLocal: false, tier: 'user', timeout: 30,
    exec: { args: ['--print', '{prompt}'], ...(stdin === undefined ? {} : { stdin }) },
  });
  const dispatch = (definition: EngineDefinition) => new CliAdapter({ findBinary: () => script } as unknown as EngineRegistry)
    .dispatch({ engine: definition, prompt: TWO_MB, cwd: dir, mode: 'exec', timeout: 30, outputDir: dir });

  it('a 2 MB prompt to a stdin-capable engine dies with E2BIG instead of arriving whole', async () => {
    const result = await dispatch(engine(true));
    expect(result.stderr).toBe('');
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('stdin=2000000');
  });

  it('a 2 MB prompt to an argv-only engine surfaces a raw E2BIG instead of naming the engine and size', async () => {
    rmSync(ranMarker, { force: true });
    const result = await dispatch(engine());
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('fake-engine');
    expect(result.stderr).toContain('2,000,000');
    expect(result.stderr).not.toContain('E2BIG');
    expect(existsSync(ranMarker)).toBe(false);
  });

  it('an agy-style event-stream engine loses the prompt or its answer when stdin delivery rewrites the flag and the NDJSON envelope', async () => {
    const argvFile = join(dir, 'argv');
    const stdinFile = join(dir, 'stdin');
    const agyScript = join(dir, 'fake-agy');
    writeFileSync(agyScript, `#!/bin/sh\nfor a in "$@"; do echo "$a"; done > "${argvFile}"\ncat > "${stdinFile}"\necho 'diagnostic noise'\necho '{"event":"progress"}'\necho '{"event":"result","result":{"response":"answer from agy"}}'\n`);
    chmodSync(agyScript, 0o755);
    const definition: EngineDefinition = {
      schemaVersion: 3, id: 'fake-agy', displayName: 'Fake agy', binary: 'fake-agy', isLocal: false, tier: 'user', timeout: 30,
      review: {
        args: ['--print-timeout', '400s', '--print', '{prompt}', '--dangerously-skip-permissions'],
        stdin: { promptFlag: '--print', args: ['--input-format', 'stream-json', '--output-format', 'stream-json'], envelope: 'event-stream' },
      },
    };
    const result = await new CliAdapter({ findBinary: () => agyScript } as unknown as EngineRegistry)
      .dispatch({ engine: definition, prompt: TWO_MB, cwd: dir, mode: 'review', timeout: 30, outputDir: dir });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('answer from agy');
    expect(readFileSync(argvFile, 'utf8').split('\n').filter(Boolean)).toEqual([
      '--print-timeout', '400s', '--print=', '--dangerously-skip-permissions', '--input-format', 'stream-json', '--output-format', 'stream-json',
    ]);
    expect(JSON.parse(readFileSync(stdinFile, 'utf8'))).toEqual({ event: 'user', message: { role: 'user', content: TWO_MB } });
  });
});
