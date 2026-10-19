import { runCommand } from 'citty';
import type { CommandDef } from 'citty';
import type { CommandContribution } from '../../packages/mod-api/src/index.js';
import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ calls: [] as string[], inputs: [] as unknown[], flagProjection: false, requiredIntent: false,
  disabled: new Set<string>(), failure: false, generation: 0, goalProjection: undefined as CommandContribution | undefined }));
vi.mock('../../packages/cli/src/surface-authority-runtime.js', () => {
  const entries = () => ['ratings', 'ratings purge-unknown', ...(state.goalProjection ? ['goal'] : [])].map(publicId => ({ publicId, category: 'cliCommands', description: publicId, aliases: publicId === 'ratings' ? ['scores'] : [] }));
  const check = (_surface: string, id: string) => { if (state.disabled.has(id)) throw new Error(`disabled: ${id}`); };
  return {
    processSurfacePublicIds: () => new Set(entries().map(entry => entry.publicId)),
    processSurfaceCatalog: entries,
    captureProcessSurfaceAuthority: () => {
      const generation = state.generation;
      return () => { if (generation !== state.generation) throw new Error('stale generation'); };
    },
    assertProcessSurfaceAvailable: check,
    processSurfaceClient: () => ({ assertAvailable(id: string) {
      check('cli', id);
      return { owner: { id: id === 'goal' ? 'agon.goal' : 'agon.ratings' }, payload: {
        inputSchema: state.goalProjection?.inputSchema ?? { type: 'object', additionalProperties: false, required: state.requiredIntent ? ['intent'] : [], properties: state.flagProjection ? {
          dryRun: { type: 'boolean', default: false }, requireTests: { type: 'boolean', default: true },
          gateTimeout: { type: 'string', default: '1800' }, reviewEngines: { type: 'string' }, intent: { type: 'string' },
        } : {} }, cli: state.goalProjection?.cli ?? (state.flagProjection ? { positionals: ['intent'], aliases: { reviewEngines: 'r' } } : {}),
        run(input: unknown) { state.inputs.push(input); state.calls.push(id); if (state.failure) throw new Error('child failed'); return { exitCode: 0 }; },
      } };
    } }),
  };
});
import { createGeneratedLazySubCommands, normalizeCliArguments } from '../../packages/cli/src/lazy-commands.js';

beforeEach(() => { state.calls = []; state.inputs = []; state.flagProjection = false; state.requiredIntent = false; state.disabled.clear(); state.failure = false; state.generation = 0; state.goalProjection = undefined; });

it('parses actual supervised Goal restart arguments through the generated Goal route', async () => {
  const { createMod, runGoalSupervisor } = await import('../../packages/mod-goal/src/implementation.js');
  const command = vi.fn((_surface: string, _contribution: CommandContribution) => () => {});
  await createMod({} as never).activate({ command, planStep: () => () => {},
    tool: () => () => {}, resultType: () => () => {} } as never);
  state.goalProjection = command.mock.calls.find(([surface]) => surface === 'cli')![1];
  const tasks = [{ id: 'first', source: 'a quoted "task" with\nnewlines' }];
  const root = { subCommands: createGeneratedLazySubCommands() };
  const runChild = vi.fn(async (args: readonly string[]) => {
    await runCommand(root, { rawArgs: await normalizeCliArguments(root, [...args]) });
    return { exitCode: state.inputs.length === 1 ? 137 : 0, outputTail: '' };
  });
  const result = await runGoalSupervisor({ intent: 'supervised goal', tasks,
    engines: ['builder', 'reviewer'], requireTests: false, commit: false }, {
    nodeExec: '/node', agonEntry: '/agon.js', runChild, wait: async () => {}, interrupted: () => false,
  });
  expect(result.exitCode).toBe(0);
  expect(runChild).toHaveBeenCalledTimes(2);
  expect(state.calls).toEqual(['goal', 'goal']);
  const expected = expect.objectContaining({ intent: 'supervised goal', tasks: JSON.stringify(tasks),
    engines: 'builder,reviewer', requireTests: false, commit: false, resume: true });
  expect(state.inputs).toEqual([expected, expected]);
});

it('accepts a kebab-case boolean before a required positional', async () => {
  state.flagProjection = true;
  state.requiredIntent = true;
  const root = { subCommands: createGeneratedLazySubCommands() };
  await runCommand(root, { rawArgs: await normalizeCliArguments(root, ['ratings', 'purge-unknown', '--dry-run', 'task']) });
  expect(state.inputs).toEqual([expect.objectContaining({ dryRun: true, intent: 'task' })]);
});

it.each([
  [['--dry-run'], { dryRun: true }],
  [['--dryRun'], { dryRun: true }],
  [['--no-require-tests'], { requireTests: false }],
  [['--gate-timeout', '25'], { gateTimeout: '25' }],
  [['--gate-timeout=25'], { gateTimeout: '25' }],
  [['--review-engines', 'fixture'], { reviewEngines: 'fixture' }],
  [['-r', 'fixture'], { reviewEngines: 'fixture' }],
  [['--', '--dry-run'], { intent: '--dry-run', dryRun: false }],
] as const)('preserves explicit CLI spelling %j over defaults', async (args, expected) => {
  state.flagProjection = true;
  await runCommand({ subCommands: createGeneratedLazySubCommands() }, { rawArgs: ['ratings', 'purge-unknown', ...args] });
  expect(state.inputs).toHaveLength(1);
  expect(state.inputs[0]).toMatchObject(expected);
});
it('keeps the parent action for an empty positional argument, matching Citty', async () => {
  await runCommand({ subCommands: createGeneratedLazySubCommands() }, { rawArgs: ['ratings', ''] });
  expect(state.calls).toEqual(['ratings']);
});
it('rejects a stale cached generation before any nested contribution runs', async () => {
  const root = { subCommands: createGeneratedLazySubCommands() };
  state.generation++;
  await expect(runCommand(root, { rawArgs: ['ratings', 'purge-unknown'] })).rejects.toThrow('stale generation');
  expect(state.calls).toEqual([]);
});
it('runs the parent action when no child was selected', async () => {
  await runCommand({ subCommands: createGeneratedLazySubCommands() }, { rawArgs: ['ratings'] });
  expect(state.calls).toEqual(['ratings']);
});
it.each(['enabled', 'disabled', 'stale'])('preserves direct run authority when %s', async mode => {
  const command = createGeneratedLazySubCommands().ratings as CommandDef;
  if (mode === 'disabled') state.disabled.add('ratings');
  if (mode === 'stale') state.generation++;
  const pending = command.run!({ args: {} } as never);
  if (mode === 'enabled') { await pending; expect(state.calls).toEqual(['ratings']); }
  else { await expect(pending).rejects.toThrow(); expect(state.calls).toEqual([]); }
});
it.each(['ratings', 'scores'])('runs only the selected child through %s', async name => {
  await runCommand({ subCommands: createGeneratedLazySubCommands() }, { rawArgs: [name, 'purge-unknown'] });
  expect(state.calls).toEqual(['ratings purge-unknown']);
});
it.each(['ratings', 'ratings purge-unknown'])('rejects cached disabled %s before any effect', async disabled => {
  const root = { subCommands: createGeneratedLazySubCommands() };
  state.disabled.add(disabled);
  await expect(runCommand(root, { rawArgs: ['ratings', 'purge-unknown'] })).rejects.toThrow('disabled');
  expect(state.calls).toEqual([]);
});
it('rejects unknown children without running the parent', async () => {
  await expect(runCommand({ subCommands: createGeneratedLazySubCommands() }, { rawArgs: ['ratings', 'unknown'] })).rejects.toThrow('Unknown command');
  expect(state.calls).toEqual([]);
});
it('preserves child failure without running the parent', async () => {
  state.failure = true;
  await expect(runCommand({ subCommands: createGeneratedLazySubCommands() }, { rawArgs: ['ratings', 'purge-unknown'] })).rejects.toThrow('child failed');
  expect(state.calls).toEqual(['ratings purge-unknown']);
});
