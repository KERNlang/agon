import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createGeneratedLazySubCommands, parseGeneratedCommandLine } from '../../packages/cli/src/lazy-commands.js';
import { disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';
import frozenWorktree from '../fixtures/modular-worktree-command-contract.json';
import frozenTribunal from '../fixtures/modular-tribunal-command-contract.json';
import frozenConquer from '../fixtures/modular-conquer-command-contract.json';
import frozenCampfire from '../fixtures/modular-campfire-command-contract.json';
import frozenThink from '../fixtures/modular-think-command-contract.json';
import frozenCouncil from '../fixtures/modular-council-command-contract.json';

type CommandDef = {
  meta?: { name?: string };
  args?: Record<string, unknown> | (() => Record<string, unknown> | Promise<Record<string, unknown>>);
  subCommands?: Record<string, CommandDef> | (() => Record<string, CommandDef> | Promise<Record<string, CommandDef>>);
};

const legacyModules = import.meta.glob('../../packages/cli/src/commands/*.ts', { eager: true }) as Record<string, Record<string, unknown>>;
const root = mkdtempSync(join(tmpdir(), 'agon-cli-contract-parity-'));

beforeAll(() => initializeProcessSurfaceAuthority(join(root, 'host')));
afterAll(async () => {
  await disposeProcessSurfaceAuthority();
  rmSync(root, { recursive: true, force: true });
});

const physicalTopLevel = [
  'ask', 'think', 'brainstorm', 'team-brainstorm', 'campfire', 'tribunal', 'team-tribunal',
  'review', 'nero', 'council', 'synthesis', 'forge', 'team-forge', 'conquer', 'goal',
  'sanitize', 'naturalize', 'mutate', 'rag', 'research', 'history', 'last', 'leaderboard',
  'ratings', 'provenance', 'room', 'agent-guide', 'install-agent-prompts', 'worktree',
  'serve', 'drive', 'chrome', 'ext', 'browser-host',
] as const;

function allLegacyCommands(): CommandDef[] {
  return [frozenWorktree.command, frozenTribunal.command, frozenConquer.command, frozenCampfire.command, frozenThink.command, frozenCouncil.command, ...Object.values(legacyModules).flatMap((module) => Object.values(module))]
    .filter((value): value is CommandDef => Boolean(value && typeof value === 'object' && (value as CommandDef).meta?.name));
}

async function resolveMap<T>(value: Record<string, T> | (() => Record<string, T> | Promise<Record<string, T>>) | undefined): Promise<Record<string, T>> {
  if (!value) return {};
  return typeof value === 'function' ? await value() : value;
}

async function argumentContract(command: CommandDef): Promise<Record<string, unknown>> {
  const args = await resolveMap(command.args);
  return Object.fromEntries(Object.entries(args).map(([name, raw]) => {
    const spec = raw as { type?: string; required?: boolean; alias?: string | readonly string[]; default?: unknown };
    return [name, {
      type: spec.type ?? 'string',
      required: spec.required === true,
      aliases: spec.alias === undefined ? [] : [...new Set(Array.isArray(spec.alias) ? spec.alias : [spec.alias])].sort(),
      ...(spec.default === undefined ? {} : { default: spec.default }),
    }];
  }));
}

async function treeContract(command: CommandDef): Promise<{ args: Record<string, unknown>; children: Record<string, unknown> }> {
  const children = await resolveMap(command.subCommands);
  return {
    args: await argumentContract(command),
    children: Object.fromEntries(await Promise.all(Object.entries(children).map(async ([name, child]) => [name, await treeContract(child)]))),
  };
}

function contractDiff(actual: unknown, expected: unknown, path = ''): string[] {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return [];
  if (!actual || !expected || typeof actual !== 'object' || typeof expected !== 'object') {
    return [`${path || '<root>'}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`];
  }
  const left = actual as Record<string, unknown>;
  const right = expected as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort();
  return keys.flatMap((key) => key in left && key in right
    ? contractDiff(left[key], right[key], path ? `${path}.${key}` : key)
    : [`${path ? `${path}.` : ''}${key}: ${key in left ? 'extra' : 'missing'}`]);
}

function legacyTop(name: string): CommandDef | undefined {
  return allLegacyCommands().find((command) => command.meta?.name === name && (name !== 'install' && name !== 'status'));
}

describe('physical CLI contract parity', () => {
  it('preserves last-value selection for repeated Provenance options and aliases', async () => {
    expect(await parseGeneratedCommandLine('provenance', '--id first --id second --format md --format json --out first.md --out second.json'))
      .toMatchObject({ id: 'second', format: 'json', out: 'second.json' });
    expect(await parseGeneratedCommandLine('provenance', '-f md -f json -o first.md -o second.json'))
      .toMatchObject({ format: 'json', out: 'second.json' });
    expect(await parseGeneratedCommandLine('provenance', '--format md -f json --out first.md -o second.json'))
      .toMatchObject({ format: 'md', out: 'first.md' });
  });

  it('combines repeated Ratings keep lists instead of discarding earlier values', async () => {
    expect(await parseGeneratedCommandLine('ratings purge-unknown', '--keep first,second --keep third --dry-run'))
      .toMatchObject({ keep: 'first,second,third', 'dry-run': true });
  });

  it('protects both repeated keep values during an actual generated Ratings preview', async () => {
    const home = join(root, 'ratings-repeat-dispatch');
    mkdirSync(home, { recursive: true });
    const path = join(home, 'ratings.json');
    const fixture = JSON.stringify({ global: { 'repeat-first': {}, 'repeat-second': {}, 'repeat-unkept': {} } });
    writeFileSync(path, fixture);
    vi.stubEnv('AGON_HOME', home);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const children = await resolveMap((createGeneratedLazySubCommands().ratings as CommandDef).subCommands);
      const command = children['purge-unknown'] as CommandDef & { run(context: unknown): Promise<void> };
      await command.run({ args: {}, rawArgs: ['--keep', 'repeat-first', '--keep', 'repeat-second', '--dry-run'] });
      const report = JSON.parse(write.mock.calls.map(([text]) => String(text)).join(''));
      expect(report.dryRun).toBe(true);
      expect(report.ratingsUnknown).toEqual(['repeat-unkept']);
      expect(readFileSync(path, 'utf8')).toBe(fixture);
    } finally {
      write.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it('preserves positional arrays and rejects repetition without an explicit policy', async () => {
    expect(await parseGeneratedCommandLine('provenance', 'first second --format json'))
      .toMatchObject({ _: ['first', 'second'], format: 'json' });
    await expect(parseGeneratedCommandLine('install-agent-prompts', '--cli codex --cli claude'))
      .rejects.toThrow(/expected string/);
  });

  it('executes the generated CLI with repeated options before validating its owner input', async () => {
    const home = join(root, 'repeat-dispatch');
    mkdirSync(join(home, 'runs'), { recursive: true });
    writeFileSync(join(home, 'runs', 'selected.json'), JSON.stringify({ forgeId: 'selected', task: 'repeat fixture', timestamp: '2026' }));
    vi.stubEnv('AGON_HOME', home);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const command = createGeneratedLazySubCommands().provenance as CommandDef & { run(context: unknown): Promise<void> };
      await command.run({ args: {}, rawArgs: ['--id', 'missing', '--id', 'selected', '--format', 'md', '--format', 'json'] });
      const output = write.mock.calls.map(([text]) => String(text)).join('');
      expect(JSON.parse(output).runId).toBe('selected');
    } finally {
      write.mockRestore();
      vi.unstubAllEnvs();
    }
  });

  it.each([[], [null, 'json'], [42, 'json'], [{ hidden: true }, 'json']].map(format => ({ format })))('does not coerce malformed repeated values $format', async ({ format }) => {
    const command = createGeneratedLazySubCommands().provenance as CommandDef & { run(context: unknown): Promise<void> };
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      await expect(command.run({ args: { format } })).rejects.toThrow(/expected string/);
      expect(write).not.toHaveBeenCalled();
    } finally {
      write.mockRestore();
    }
  });

  it('preserves frozen Council command and option help text', async () => {
    const current = createGeneratedLazySubCommands().council as CommandDef;
    expect(current.meta).toEqual(frozenCouncil.command.meta);
    const args = await resolveMap(current.args);
    for (const [name, expected] of Object.entries(frozenCouncil.command.args)) {
      expect(args[name], `Council help: ${name}`).toMatchObject({ description: expected.description });
    }
  });
  it('preserves frozen Think command and option help text', async () => {
    const current = createGeneratedLazySubCommands().think as CommandDef;
    expect(current.meta).toEqual(frozenThink.command.meta);
    const args = await resolveMap(current.args);
    for (const [name, expected] of Object.entries(frozenThink.command.args)) {
      expect(args[name], `Think help: ${name}`).toMatchObject({ description: expected.description });
    }
  });
  it('preserves frozen Campfire command and option help text', async () => {
    const current = createGeneratedLazySubCommands().campfire as CommandDef;
    expect(current.meta).toEqual(frozenCampfire.command.meta);
    const args = await resolveMap(current.args);
    for (const [name, expected] of Object.entries(frozenCampfire.command.args)) {
      expect(args[name], `Campfire help: ${name}`).toMatchObject({ description: expected.description });
    }
  });
  it.each(physicalTopLevel.filter((name) => name !== 'serve'))('preserves the legacy %s contract plus explicit Goal supervisor additions', async (name) => {
    const generated = createGeneratedLazySubCommands();
    const legacy = legacyTop(name);
    const current = generated[name] as CommandDef | undefined;
    expect(legacy, `missing frozen legacy command ${name}`).toBeDefined();
    expect(current, `missing generated command ${name}`).toBeDefined();
    const actual = await treeContract(current!);
    const expected = await treeContract(legacy!);
    if (name === 'goal') {
      // Supervised restarts must retain task arrays and explicit commit refusal.
      // The run identity prevents adoption of a competing checkpoint.
      // All legacy fields stay exact.
      expect(expected.args).not.toHaveProperty('tasks');
      expect(expected.args).not.toHaveProperty('commit');
      expect(expected.args).not.toHaveProperty('supervisorRunId');
      expected.args.tasks = { type: 'string', required: false, aliases: [] };
      expected.args.commit = { type: 'boolean', required: false, aliases: [], default: true };
      expected.args.supervisorRunId = { type: 'string', required: false, aliases: [] };
      expect(expected.args).not.toHaveProperty('mutateBuild');
      expect(expected.args).not.toHaveProperty('mutateTypecheck');
      expected.args.mutateBuild = { type: 'string', required: false, aliases: [] };
      expected.args.mutateTypecheck = { type: 'string', required: false, aliases: [] };
    }
    if (name === 'review') {
      expect(expected.args).not.toHaveProperty('deadline');
      expected.args.deadline = { type: 'string', required: false, aliases: [] };
      expect(expected.args).not.toHaveProperty('format');
      expected.args.format = { type: 'string', required: false, aliases: [], default: 'json' };
    }
    if (name === 'forge') {
      expect(expected.args).not.toHaveProperty('format');
      expected.args.format = { type: 'string', required: false, aliases: [], default: 'json' };
    }
    expect(contractDiff(actual, expected)).toEqual([]);
  });

  it('executes a physical contribution through the generated command', async () => {
    const generated = createGeneratedLazySubCommands();
    const sanitize = generated.sanitize as CommandDef & { run: (context: unknown) => Promise<void> };
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    try {
      const input = join(root, 'sanitize-input.txt');
      writeFileSync(input, 'already clean');
      await sanitize.run({ args: { file: input } });
      expect(write).toHaveBeenCalledWith('already clean');
    } finally {
      write.mockRestore();
    }
  });
});
