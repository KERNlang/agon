import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Every process-spawning entry point of node:child_process is wrapped so the
// test can PROVE `agon flow validate` never dispatches an engine (spec
// acceptance criterion: "zero engine dispatches occur").
const spawnCalls = vi.hoisted(() => ({ count: 0, commands: [] as string[] }));
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const wrap = <T extends (...args: any[]) => any>(fn: T): T => ((...args: any[]) => {
    spawnCalls.count += 1;
    spawnCalls.commands.push(String(args[0]));
    return (fn as any)(...args);
  }) as unknown as T;
  return {
    ...actual,
    spawn: wrap(actual.spawn),
    spawnSync: wrap(actual.spawnSync),
    exec: wrap(actual.exec),
    execSync: wrap(actual.execSync),
    execFile: wrap(actual.execFile),
    execFileSync: wrap(actual.execFileSync),
    fork: wrap(actual.fork),
  };
});

const { flowCommand, flowValidateCommand } = await import('../../packages/cli/src/commands/flow.js');
const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'flow');

let out: string[];
let tmp: string;
let exitCode: number | undefined;

beforeEach(() => {
  out = [];
  exitCode = undefined;
  spawnCalls.count = 0;
  spawnCalls.commands = [];
  tmp = mkdtempSync(join(tmpdir(), 'agon-flow-cmd-'));
  vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
    out.push(String(chunk));
    return true;
  });
  // blocks/output-format.ts renders through console.log; the JSON payload goes
  // straight to stdout. Capture both so either shape can be asserted.
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    out.push(`${args.map((arg) => String(arg)).join(' ')}\n`);
  });
  vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    exitCode = code;
    return undefined as never;
  }) as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(tmp, { recursive: true, force: true });
});

async function run(args: Record<string, unknown>): Promise<void> {
  await flowValidateCommand.run({ args, cmd: flowValidateCommand, rawArgs: [] });
}

describe('agon flow — command wiring', () => {
  it('exposes `validate` as a subcommand of `flow`', () => {
    expect(flowCommand.meta.name).toBe('flow');
    expect(Object.keys(flowCommand.subCommands)).toEqual(['validate']);
    expect(flowValidateCommand.args.file.required).toBe(true);
  });
});

describe('agon flow validate', () => {
  it('accepts the build-CV golden flow and emits the elaborated step-DAG as JSON', async () => {
    await run({ file: join(FIXTURES, 'build-cv.agon-flow.json'), json: true });
    const payload = JSON.parse(out.join(''));
    expect(payload.ok).toBe(true);
    expect(payload.flow.name).toBe('build-CV');
    expect(payload.flow.steps.length).toBe(8);
    expect(payload.flow.params.map((param: { key: string }) => param.key))
      .toEqual(['experience', 'rubric', 'destination']);
    expect(exitCode).toBeUndefined();
  });

  it('accepts the subflow golden flow with its namespaced params', async () => {
    await run({ file: join(FIXTURES, 'cv-with-subflow.agon-flow.json'), json: true });
    const payload = JSON.parse(out.join(''));
    expect(payload.ok).toBe(true);
    expect(payload.flow.params.map((param: { key: string }) => param.key))
      .toContain('01JPSSBF000000000000000000.footer');
  });

  it('prints a human report for a valid flow', async () => {
    await run({ file: join(FIXTURES, 'sort-folder.agon-flow.json') });
    const text = out.join('');
    expect(text).toContain('sort-folder');
    expect(text).toContain('valid');
    expect(exitCode).toBeUndefined();
  });

  it('exits 1 with node-id-addressed errors for a bad flow', async () => {
    const bad = join(tmp, 'bad.agon-flow.json');
    writeFileSync(bad, JSON.stringify({
      schemaVersion: 1,
      version: '1.0.0',
      id: '01JBAD0000000000000000000B',
      name: 'bad',
      params: [],
      nodes: [
        { id: '01JCHAT000000000000000000B', type: 'chat-input', params: { paramKey: 'x' }, position: { x: 0, y: 0 } },
        { id: '01JSCAN000000000000000000B', type: 'list-folder', params: {}, position: { x: 0, y: 0 } },
      ],
      edges: [{ from: '01JCHAT000000000000000000B.text', to: '01JSCAN000000000000000000B.folder' }],
      outputs: [],
    }, null, 2));

    await run({ file: bad, json: true });
    const payload = JSON.parse(out.join(''));
    expect(payload.ok).toBe(false);
    expect(payload.errors[0].code).toBe('PORT_TYPE_MISMATCH');
    expect(payload.errors[0].nodeId).toBe('01JSCAN000000000000000000B');
    expect(exitCode).toBe(1);
  });

  it('exits 1 when the file does not exist', async () => {
    await run({ file: join(tmp, 'nope.agon-flow.json'), json: true });
    expect(JSON.parse(out.join('')).ok).toBe(false);
    expect(exitCode).toBe(1);
  });

  it('spawns NO process for any of the above — validation is free', async () => {
    await run({ file: join(FIXTURES, 'build-cv.agon-flow.json'), json: true });
    await run({ file: join(FIXTURES, 'sort-folder.agon-flow.json'), json: true });
    await run({ file: join(FIXTURES, 'cv-with-subflow.agon-flow.json'), json: true });
    expect(spawnCalls.count, `spawned: ${spawnCalls.commands.join(', ')}`).toBe(0);
  });
});
