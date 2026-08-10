import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EngineRegistry } from '../../packages/core/src/index.js';
import { runTeamBrainstorm, runTeamTribunal } from '../../packages/forge/src/index.js';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

let agonHome: string;
beforeEach(() => { agonHome = setupTestAgonHome('team-prompt-routing'); });
afterEach(() => { cleanupTestAgonHome(agonHome); });

function registryWithTwoEngines(): EngineRegistry {
  const registry = new EngineRegistry();
  for (const id of ['e1', 'e2']) {
    registry.register({
      schemaVersion: 3, id, displayName: id, binary: process.execPath,
      exec: { args: ['{prompt}'] }, review: { args: ['{prompt}'] },
    } as any);
  }
  return registry;
}

function recordingAdapter(modes: string[], systemPrompts: string[] = [], cwds: string[] = []) {
  return {
    dispatch: async (options: { mode: string; prompt: string; systemPrompt?: string; cwd: string }) => {
      modes.push(options.mode);
      systemPrompts.push(options.systemPrompt ?? '');
      cwds.push(options.cwd);
      const judge = options.prompt.includes('JUDGE');
      return {
        exitCode: 0, timedOut: false, stderr: '', durationMs: 1,
        stdout: judge ? 'SCORE_ALPHA: 70\nSCORE_BETA: 30\nWINNER: ALPHA' : 'Prompt-grounded team contribution',
      };
    },
  } as any;
}

describe('team prompt routing', () => {
  it('uses exec for every team-tribunal strategy, synthesis, and judge prompt', async () => {
    const modes: string[] = [];
    const systemPrompts: string[] = [];
    const cwds: string[] = [];
    await runTeamTribunal({
      question: 'rollback?', membersPerSide: 1, rounds: 1, mode: 'red-team',
      composeMode: 'explicit', explicitTeams: [['e1'], ['e2']], engines: ['e1', 'e2'],
      registry: registryWithTwoEngines(), adapter: recordingAdapter(modes, systemPrompts, cwds),
      timeout: 10, outputDir: agonHome,
    } as any);
    expect(modes.length).toBeGreaterThanOrEqual(5);
    expect(new Set(modes)).toEqual(new Set(['exec']));
    expect(systemPrompts.every((prompt) => prompt.includes('Do not use tools'))).toBe(true);
    expect(new Set(cwds)).toEqual(new Set([agonHome]));
  });

  it('uses exec for the team-brainstorm judge as well as draft and synthesis prompts', async () => {
    const modes: string[] = [];
    const cwds: string[] = [];
    await runTeamBrainstorm({
      question: 'migration?', membersPerSide: 1,
      composeMode: 'explicit', explicitTeams: [['e1'], ['e2']], engines: ['e1', 'e2'],
      registry: registryWithTwoEngines(), adapter: recordingAdapter(modes, [], cwds),
      timeout: 10, outputDir: agonHome,
    } as any);
    expect(modes.length).toBeGreaterThanOrEqual(5);
    expect(new Set(modes)).toEqual(new Set(['exec']));
    expect(new Set(cwds)).toEqual(new Set([agonHome]));
  });
});
