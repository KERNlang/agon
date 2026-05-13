import { describe, expect, it } from 'vitest';

import { buildCallCommands } from '../../packages/cli/src/commands/call.js';

describe('agon call command mapping', () => {
  it('maps tribunal to the live team tribunal bridge', () => {
    expect(buildCallCommands({
      workflow: 'tribunal',
      input: 'Should Agon own the second-opinion workflow?',
      team: true,
      engines: 'codex,claude,gemini',
      rounds: '3',
      tribunalMode: 'red-team',
      members: '3',
      engineTimeout: '180',
    }).commands).toEqual([
      [
        'team-tribunal',
        'Should Agon own the second-opinion workflow?',
        '--rounds',
        '3',
        '--mode',
        'red-team',
        '--members',
        '3',
        '--timeout',
        '180',
        '--engines',
        'codex,claude,gemini',
      ],
    ]);
  });

  it('maps pipeline to brainstorm, forge, then tribunal', () => {
    expect(buildCallCommands({
      workflow: 'pipeline',
      input: 'Make the bridge live',
      fitnessCmd: 'npm test',
      cwd: '/tmp/project',
      tribunalMode: 'synthesis',
    }).commands).toEqual([
      ['brainstorm', 'Make the bridge live'],
      ['forge', 'Make the bridge live', '--test', 'npm test', '--cwd', '/tmp/project'],
      ['tribunal', 'Review the pipeline result for: Make the bridge live', '--rounds', '1', '--mode', 'synthesis'],
    ]);
  });

  it('defaults review target to uncommitted', () => {
    expect(buildCallCommands({ workflow: 'review' }).commands).toEqual([
      ['review', 'uncommitted'],
    ]);
  });

  it('forwards --finalize-on-score to solo forge', () => {
    const { commands } = buildCallCommands({
      workflow: 'forge',
      input: 'Add a unit test',
      fitnessCmd: 'npm test',
      cwd: '/tmp/project',
      finalizeOnScore: '85',
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toContain('--finalize-on-score');
    const idx = commands[0].indexOf('--finalize-on-score');
    expect(commands[0][idx + 1]).toBe('85');
  });

  it('does NOT forward --finalize-on-score to team-forge', () => {
    const { commands } = buildCallCommands({
      workflow: 'team-forge',
      input: 'Add a unit test',
      fitnessCmd: 'npm test',
      cwd: '/tmp/project',
      finalizeOnScore: '85',
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).not.toContain('--finalize-on-score');
  });

  it('omits --finalize-on-score when not provided', () => {
    const { commands } = buildCallCommands({
      workflow: 'forge',
      input: 'Add a unit test',
      fitnessCmd: 'npm test',
      cwd: '/tmp/project',
    });
    expect(commands[0]).not.toContain('--finalize-on-score');
  });
});
