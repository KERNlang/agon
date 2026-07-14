import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildCallCommands, validateCallEngineRoster } from '../../packages/cli/src/commands/call.js';

describe('agon call command mapping', () => {
  it('rejects a singular engine that is hard-removed in project config', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-call-engine-'));
    writeFileSync(join(cwd, '.agon.json'), JSON.stringify({ removedEngines: ['codex'] }));
    expect(() => validateCallEngineRoster('codex', cwd)).toThrow(/hard-removed/i);
  });

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

  it('forwards a protocol override to a solo tribunal', () => {
    expect(buildCallCommands({
      workflow: 'tribunal',
      input: 'Should the seats respond to each other?',
      tribunalMode: 'socratic',
      tribunalProtocol: 'chained',
    }).commands).toEqual([
      ['tribunal', 'Should the seats respond to each other?', '--mode', 'socratic', '--protocol', 'chained'],
    ]);
  });

  it('rejects an invalid tribunal protocol before constructing a pipeline', () => {
    expect(() => buildCallCommands({
      workflow: 'pipeline',
      input: 'Make the bridge live',
      fitnessCmd: 'npm test',
      cwd: '/tmp/project',
      tribunalProtocol: 'paralell',
    })).toThrow('Invalid tribunal protocol');
  });

  it('rejects a protocol override for team tribunal instead of ignoring it', () => {
    expect(() => buildCallCommands({
      workflow: 'team-tribunal',
      input: 'Should teams chain their internal work?',
      tribunalProtocol: 'hybrid',
    })).toThrow('solo tribunal only');
  });

  it('accepts protocol auto for team tribunal as a no-op default', () => {
    expect(buildCallCommands({
      workflow: 'team-tribunal',
      input: 'Should the teams debate this?',
      tribunalProtocol: 'auto',
    }).commands).toEqual([
      ['team-tribunal', 'Should the teams debate this?'],
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

  it('maps think with a --critic engine', () => {
    expect(buildCallCommands({
      workflow: 'think',
      input: 'pick a storage engine',
      strategy: 'tot',
      branches: '3',
      critic: 'codex',
    }).commands).toEqual([
      ['think', 'pick a storage engine', '--strategy', 'tot', '--branches', '3', '--critic', 'codex'],
    ]);
  });

  it('maps think with no optional flags', () => {
    expect(buildCallCommands({ workflow: 'think', input: 'decompose this' }).commands).toEqual([
      ['think', 'decompose this'],
    ]);
  });

  it('maps nero to the adversarial self-challenge bridge', () => {
    expect(buildCallCommands({
      workflow: 'nero',
      input: 'Cache tokens in Redis',
      reasoning: 'Redis is fast and shared across workers',
      focus: 'invalidation',
      confidence: '80',
      engineTimeout: '90',
      engines: 'codex,agy',
    }).commands).toEqual([
      ['nero', 'Cache tokens in Redis', '--reasoning', 'Redis is fast and shared across workers', '--focus', 'invalidation', '--confidence', '80', '--timeout', '90', '--engines', 'codex,agy'],
    ]);
  });

  it('maps nero with just the decision', () => {
    expect(buildCallCommands({ workflow: 'nero', input: 'Ship the migration tonight' }).commands).toEqual([
      ['nero', 'Ship the migration tonight'],
    ]);
  });

  it('maps research to the keyless-research bridge with --count and --engine', () => {
    expect(buildCallCommands({
      workflow: 'research',
      input: 'how does the npm p-retry package back off?',
      count: '6',
      engine: 'codex',
      engineTimeout: '90',
      engines: 'codex,agy',
    }).commands).toEqual([
      ['research', 'how does the npm p-retry package back off?', '--count', '6', '--engine', 'codex', '--timeout', '90', '--engines', 'codex,agy'],
    ]);
  });

  it('maps research with just the question', () => {
    expect(buildCallCommands({ workflow: 'research', input: 'what is the WHATWG URL spec?' }).commands).toEqual([
      ['research', 'what is the WHATWG URL spec?'],
    ]);
  });

  it('maps council to the roundtable bridge with roles/chairman', () => {
    expect(buildCallCommands({
      workflow: 'council',
      input: 'Adopt event sourcing for the ledger?',
      roles: 'Contrarian,Red-Team',
      chairman: 'claude',
      engineTimeout: '150',
      engines: 'codex,agy,claude',
    }).commands).toEqual([
      ['council', 'Adopt event sourcing for the ledger?', '--roles', 'Contrarian,Red-Team', '--chairman', 'claude', '--timeout', '150', '--engines', 'codex,agy,claude'],
    ]);
  });

  it('maps conquer to the supervised-build bridge with --gate', () => {
    expect(buildCallCommands({
      workflow: 'conquer',
      input: 'Build a CSV importer',
      gate: 'npm run build && npm test',
      engineTimeout: '600',
      engines: 'codex,claude',
    }).commands).toEqual([
      ['conquer', 'Build a CSV importer', '--gate', 'npm run build && npm test', '--timeout', '600', '--engines', 'codex,claude'],
    ]);
  });

  it('maps conquer with just the task + gate', () => {
    expect(buildCallCommands({ workflow: 'conquer', input: 'Build X', gate: 'npm test' }).commands).toEqual([
      ['conquer', 'Build X', '--gate', 'npm test'],
    ]);
  });

  it('maps council with just the question', () => {
    expect(buildCallCommands({ workflow: 'council', input: 'Rewrite the scheduler?' }).commands).toEqual([
      ['council', 'Rewrite the scheduler?'],
    ]);
  });

  it('requires input for council', () => {
    expect(() => buildCallCommands({ workflow: 'council' })).toThrow('agon call council requires a prompt/task argument');
  });

  it('maps goal with --oracle-gate forwarded', () => {
    expect(buildCallCommands({
      workflow: 'goal',
      input: 'close all kern gaps',
      cwd: '/tmp/project',
      queue: '.kern-gaps/',
      gate: 'npm test',
      oracleGate: 'strict',
    }).commands).toEqual([
      ['goal', 'close all kern gaps', '--cwd', '/tmp/project', '--queue', '.kern-gaps/', '--gate', 'npm test', '--oracle-gate', 'strict'],
    ]);
  });

  it('omits --oracle-gate when not provided', () => {
    const { commands } = buildCallCommands({ workflow: 'goal', input: 'x', cwd: '/tmp/p', queue: '.q/', gate: 'true' });
    expect(commands[0]).not.toContain('--oracle-gate');
  });

  it('maps chrome to the browser-driving bridge', () => {
    expect(buildCallCommands({ workflow: 'chrome', input: 'check the pricing page design' }).commands).toEqual([
      ['chrome', 'check the pricing page design'],
    ]);
  });

  it('maps chrome with --auto-approve and --engine', () => {
    expect(buildCallCommands({
      workflow: 'chrome',
      input: 'click the login button and screenshot the form',
      autoApprove: true,
      engine: 'codex',
    }).commands).toEqual([
      ['chrome', 'click the login button and screenshot the form', '--auto-approve', '--engine', 'codex'],
    ]);
  });

  it('omits --auto-approve for chrome when not set', () => {
    const { commands } = buildCallCommands({ workflow: 'chrome', input: 'read the page' });
    expect(commands[0]).not.toContain('--auto-approve');
  });

  it('requires input for chrome', () => {
    expect(() => buildCallCommands({ workflow: 'chrome' })).toThrow('agon call chrome requires a prompt/task argument');
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

  it('forwards --engine to review as an explicit single-reviewer request', () => {
    expect(buildCallCommands({
      workflow: 'review',
      input: 'commit:HEAD',
      engine: 'agy',
    }).commands).toEqual([
      ['review', 'commit:HEAD', '--engine', 'agy'],
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
