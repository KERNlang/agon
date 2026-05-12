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
});
