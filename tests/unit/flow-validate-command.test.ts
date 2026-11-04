import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const CLI = fileURLToPath(new URL('../../packages/cli/dist/index.js', import.meta.url));
const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'flow');

let tmp: string;
let env: NodeJS.ProcessEnv;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'agon-flow-cmd-'));
  const home = join(tmp, 'home');
  mkdirSync(join(home, 'flows'), { recursive: true });
  env = { ...process.env, HOME: home, AGON_HOME: home, AGON_MODULAR_HOST_ROOT: join(home, 'modular-host') };
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

function agon(args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], {
    cwd: options.cwd ?? tmp,
    encoding: 'utf-8',
    timeout: 60_000,
    env: options.env ?? env,
  });
  return { code: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function flowDocument(overrides: Record<string, unknown>) {
  return {
    schemaVersion: 1,
    version: '1.0.0',
    id: '01JBAD0000000000000000000B',
    name: 'fixture',
    params: [],
    nodes: [],
    edges: [],
    outputs: [],
    ...overrides,
  };
}

const CHAT = '01JCHAT000000000000000000B';
const SCAN = '01JSCAN000000000000000000B';
const portMismatch = flowDocument({
  nodes: [
    { id: CHAT, type: 'chat-input', params: { paramKey: 'x' }, position: { x: 0, y: 0 } },
    { id: SCAN, type: 'list-folder', params: {}, position: { x: 0, y: 0 } },
  ],
  edges: [{ from: `${CHAT}.text`, to: `${SCAN}.folder` }],
});

describe('agon flow validate through the built CLI', () => {
  it('reports a valid flow with its name, params and steps, from a relative path with spaces', () => {
    const directory = join(tmp, 'my flows', 'nested');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'cv.agon-flow.json'), readFileSync(join(FIXTURES, 'build-cv.agon-flow.json')));
    const result = agon(['flow', 'validate', join('nested', 'cv.agon-flow.json')], { cwd: join(tmp, 'my flows') });
    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('build-CV v');
    expect(result.stdout).toContain('experience');
    expect(result.stdout).toMatch(/^Step\s/m);
  });

  it('says no parameters for a flow that has none instead of an empty table', () => {
    const file = join(tmp, 'empty.agon-flow.json');
    writeFileSync(file, JSON.stringify(flowDocument({})));
    const result = agon(['flow', 'validate', file]);
    expect(result.stdout).toContain('no parameters');
    expect(result.code).toBe(0);
  });

  it('emits the elaborated subflow params as JSON when --json precedes the file', () => {
    const result = agon(['flow', 'validate', '--json', join(FIXTURES, 'cv-with-subflow.agon-flow.json')]);
    const payload = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(payload.ok).toBe(true);
    expect(payload.flow.params.map((param: { key: string }) => param.key))
      .toContain('01JPSSBF000000000000000000.footer');
  });

  it('exits 1 with node-addressed errors and JSON-only stdout for a bad, missing or malformed file', () => {
    const bad = join(tmp, 'bad.agon-flow.json');
    writeFileSync(bad, JSON.stringify(portMismatch));
    const malformed = join(tmp, 'malformed.agon-flow.json');
    writeFileSync(malformed, '{ not json');

    const invalid = agon(['flow', 'validate', bad, '--json']);
    const payload = JSON.parse(invalid.stdout);
    expect(invalid.code).toBe(1);
    expect(payload.ok).toBe(false);
    expect(payload.errors[0]).toMatchObject({ code: 'PORT_TYPE_MISMATCH', nodeId: SCAN });

    for (const file of [join(tmp, 'nope.agon-flow.json'), malformed]) {
      const result = agon(['flow', 'validate', file, '--json']);
      expect(result.code, file).toBe(1);
      expect(JSON.parse(result.stdout).ok, file).toBe(false);
    }

    const human = agon(['flow', 'validate', bad]);
    expect(human.code).toBe(1);
    expect(human.stdout).toContain('PORT_TYPE_MISMATCH');
  });

  it('does not truncate --json errors over 64 KB behind a slow pipe reader', async () => {
    const nodes = Array.from({ length: 2_000 }, (_, index) => ({
      id: `01JN${String(index).padStart(22, '0')}`,
      type: 'no-such-node',
      params: {},
      position: { x: 0, y: 0 },
    }));
    const file = join(tmp, 'huge.agon-flow.json');
    writeFileSync(file, JSON.stringify(flowDocument({ nodes })));

    const child = spawn(process.execPath, [CLI, 'flow', 'validate', file, '--json'], {
      cwd: tmp,
      env,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const chunks: Buffer[] = [];
    const exited = new Promise<number | null>(resolve => child.once('close', resolve));
    await new Promise(resolve => setTimeout(resolve, 2_000));
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk));

    expect(await exited).toBe(1);
    const stdout = Buffer.concat(chunks);
    expect(stdout.length).toBeGreaterThan(64 * 1024);
    expect(JSON.parse(stdout.toString('utf-8')).errors.length).toBe(nodes.length);
  });

  it('validates a flow with engine steps with no engine binary on PATH, so nothing is dispatched', () => {
    const emptyBin = join(tmp, 'empty-bin');
    mkdirSync(emptyBin);
    const result = agon(
      ['flow', 'validate', join(FIXTURES, 'build-cv.agon-flow.json'), '--json'],
      { env: { ...env, PATH: emptyBin } },
    );
    const payload = JSON.parse(result.stdout);
    expect(result.code).toBe(0);
    expect(payload.flow.steps.some((step: { type: string }) => step.type === 'engine')).toBe(true);
  });
});

describe('agon flow without a valid subcommand', () => {
  it('prints usage for bare `agon flow` without reading telemetry or recording a receipt', () => {
    writeFileSync(join(env.AGON_HOME!, 'flows', 'flow-canary.json'), JSON.stringify({ id: 'telemetry-canary' }));
    const result = agon(['flow']);
    expect(result.code).toBe(0);
    expect(result.stdout).toContain('agon flow validate <file>');
    expect(result.stdout).not.toContain('telemetry-canary');
    expect(result.stdout).not.toContain('totalFlows');
    expect(result.stdout).not.toContain('receiptId');
    expect(readdirSync(env.AGON_HOME!, { recursive: true }).sort()).toEqual(['flows', join('flows', 'flow-canary.json')]);
  });

  it('exits non-zero on an unknown subcommand instead of falling through to the parent', () => {
    const result = agon(['flow', 'bogus']);
    expect(result.code).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/unknown command/i);
  });
});
