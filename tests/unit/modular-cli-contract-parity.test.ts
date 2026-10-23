import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { createGeneratedLazySubCommands } from '../../packages/cli/src/lazy-commands.js';
import { disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';
import frozenWorktree from '../fixtures/modular-worktree-command-contract.json';
import frozenTribunal from '../fixtures/modular-tribunal-command-contract.json';

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
  return [frozenWorktree.command, frozenTribunal.command, ...Object.values(legacyModules).flatMap((module) => Object.values(module))]
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
