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

  it('maps think to the sequential-thinking bridge with strategy/steps/branches', () => {
    expect(buildCallCommands({
      workflow: 'think',
      input: 'Token bucket or sliding window?',
      strategy: 'reflexion',
      steps: '20',
      branches: '5',
      engineTimeout: '120',
      engines: 'codex',
    }).commands).toEqual([
      ['think', 'Token bucket or sliding window?', '--strategy', 'reflexion', '--steps', '20', '--branches', '5', '--timeout', '120', '--engines', 'codex'],
    ]);
  });

  it('maps think with no optional flags', () => {
    expect(buildCallCommands({ workflow: 'think', input: 'decompose this' }).commands).toEqual([
      ['think', 'decompose this'],
    ]);
  });

  it('maps synthesis to the synthesis command bridge', () => {
    expect(buildCallCommands({
      workflow: 'synthesis',
      input: 'Design a new mode',
      swaps: '2',
      engineTimeout: '90',
      engines: 'codex,gemini',
    }).commands).toEqual([
      ['synthesis', 'Design a new mode', '--swaps', '2', '--timeout', '90', '--engines', 'codex,gemini'],
    ]);
  });

  it('maps synthesis without optional flags', () => {
    expect(buildCallCommands({
      workflow: 'synthesis',
      input: 'Design a new mode',
    }).commands).toEqual([
      ['synthesis', 'Design a new mode'],
    ]);
  });

  it('normalizes synthesis workflow casing before mapping', () => {
    expect(buildCallCommands({
      workflow: 'SynTheSis',
      input: 'Design a new mode',
    }).commands).toEqual([
      ['synthesis', 'Design a new mode'],
    ]);
  });

  it('forwards timeout to synthesis without swaps', () => {
    expect(buildCallCommands({
      workflow: 'synthesis',
      input: 'Design a new mode',
      engineTimeout: '45',
    }).commands).toEqual([
      ['synthesis', 'Design a new mode', '--timeout', '45'],
    ]);
  });

  it('forwards engines to synthesis without swaps or timeout', () => {
    expect(buildCallCommands({
      workflow: 'synthesis',
      input: 'Design a new mode',
      engines: 'codex,claude',
    }).commands).toEqual([
      ['synthesis', 'Design a new mode', '--engines', 'codex,claude'],
    ]);
  });

  it('requires input for synthesis', () => {
    expect(() => buildCallCommands({
      workflow: 'synthesis',
    })).toThrow('agon call synthesis requires a prompt/task argument');
  });

  it('defaults review target to uncommitted', () => {
    expect(buildCallCommands({ workflow: 'review' }).commands).toEqual([
      ['review', 'uncommitted'],
    ]);
  });

  it('forwards --timeout and --engines to review', () => {
    expect(buildCallCommands({
      workflow: 'review',
      input: 'branch:main',
      engineTimeout: '90',
      engines: 'codex,gemini',
    }).commands).toEqual([
      ['review', 'branch:main', '--timeout', '90', '--engines', 'codex,gemini'],
    ]);
  });

  it('maps doctor to the top-level doctor command (engines by default)', () => {
    expect(buildCallCommands({ workflow: 'doctor' }).commands).toEqual([
      ['doctor', 'engines'],
    ]);
  });

  it('passes a doctor scope through (e.g. harness)', () => {
    expect(buildCallCommands({ workflow: 'doctor', input: 'harness' }).commands).toEqual([
      ['doctor', 'harness'],
    ]);
  });

  it('forwards --timeout and --engines to doctor review', () => {
    expect(buildCallCommands({
      workflow: 'doctor',
      input: 'review',
      engineTimeout: '15',
      engines: 'codex',
    }).commands).toEqual([
      ['doctor', 'review', '--timeout', '15', '--engines', 'codex'],
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
