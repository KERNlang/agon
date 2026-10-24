import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'citty';
import { describe, expect, it, vi, afterEach } from 'vitest';

import {
  buildMcpJobCommand,
  JOB_TOOLS,
  runMcpJobCommand,
} from '../../packages/mcp/src/job-tools.js';

describe('MCP autonomous job tools', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each(['--help', '--no-json', '-h'])('preserves cancellation reason %s as data', reason => {
    const command = buildMcpJobCommand('JobCancel', { jobId: 'job-1', reason });
    const parsed = parseArgs(command.slice(2), { jobId: { type: 'positional', required: true }, reason: { type: 'string' }, json: { type: 'boolean' } });
    expect(parsed.reason).toBe(reason);
    expect(parsed.json).toBe(true);
    expect(parsed.help).toBeUndefined();
  });

  it('cancels an active client that ignores SIGTERM', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agon-job-abort-'));
    const ready = join(directory, 'ready');
    const script = join(directory, 'client.cjs');
    writeFileSync(script, `process.on('SIGTERM', () => {}); const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(ready + '.tmp')}, String(process.pid)); fs.renameSync(${JSON.stringify(ready + '.tmp')}, ${JSON.stringify(ready)}); setTimeout(() => process.exit(0), 10000);`);
    vi.stubEnv('AGON_CLI_NODE_SCRIPT', script);
    const controller = new AbortController();
    const pending = runMcpJobCommand(['job', 'list', '--json'], { signal: controller.signal });
    try {
      for (let attempt = 0; !existsSync(ready) && attempt < 200; attempt++) await delay(10);
      expect(existsSync(ready)).toBe(true);
      const pid = Number(readFileSync(ready, 'utf8'));
      expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
      controller.abort();
      const result = JSON.parse(await pending);
      expect(result.ok).toBe(false);
      expect(result.exitCode).toBe(130);
      expect(() => process.kill(pid, 0)).toThrow();
    } finally {
      controller.abort();
      await pending;
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('does not launch a client for an already cancelled request', async () => {
    vi.stubEnv('AGON_CLI_NODE_SCRIPT', '/nonexistent/agon-job-client.js');
    const controller = new AbortController();
    controller.abort();
    const result = JSON.parse(await runMcpJobCommand(['job', 'list', '--json'], { signal: controller.signal }));
    expect(result.ok).toBe(false);
    expect(result.exitCode).toBe(130);
    expect(result.error).toMatch(/aborted/i);
  });

  it('runs the client in the invocation directory', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'agon-job-cwd-'));
    try {
      const script = join(directory, 'client.cjs');
      writeFileSync(script, 'console.log(JSON.stringify({cwd:process.cwd()}));');
      vi.stubEnv('AGON_CLI_NODE_SCRIPT', script);
      const result = JSON.parse(await runMcpJobCommand(['job', 'list', '--json'], { cwd: directory }));
      expect(result.cwd).toBe(realpathSync(directory));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('registers the complete non-blocking job control surface', () => {
    expect(JOB_TOOLS.map((tool) => tool.name)).toEqual([
      'JobSubmit', 'JobList', 'JobStatus', 'JobEvents', 'JobResult', 'JobCancel',
    ]);
  });

  it('submits only a structured payload through the fixed agon job client', () => {
    expect(buildMcpJobCommand('JobSubmit', {
      kind: 'brainstorm',
      payload: { input: 'design a cache', engines: 'claude,codex' },
    })).toEqual([
      'job', 'submit', 'brainstorm', '--payload',
      JSON.stringify({ input: 'design a cache', engines: 'claude,codex' }), '--json',
    ]);
  });

  it('builds fixed list/status/events/result/cancel requests', () => {
    expect(buildMcpJobCommand('JobList', {})).toEqual(['job', 'list', '--json']);
    expect(buildMcpJobCommand('JobStatus', { jobId: 'job-1' })).toEqual(['job', 'status', 'job-1', '--json']);
    expect(buildMcpJobCommand('JobEvents', { jobId: 'job-1', afterSeq: 4, limit: 20 }))
      .toEqual(['job', 'events', 'job-1', '--after', '4', '--limit', '20', '--json']);
    expect(buildMcpJobCommand('JobResult', { jobId: 'job-1' })).toEqual(['job', 'result', 'job-1', '--json']);
    expect(buildMcpJobCommand('JobCancel', { jobId: 'job-1', reason: 'operator request' }))
      .toEqual(['job', 'cancel', 'job-1', '--reason=operator request', '--json']);
  });

  it('rejects malformed ids, payloads, and replay bounds before spawning', () => {
    expect(() => buildMcpJobCommand('JobSubmit', { kind: '', payload: {} })).toThrow(/kind is required/i);
    expect(() => buildMcpJobCommand('JobSubmit', { kind: 'review', payload: [] })).toThrow(/payload must be an object/i);
    expect(() => buildMcpJobCommand('JobStatus', { jobId: '' })).toThrow(/jobId is required/i);
    expect(() => buildMcpJobCommand('JobEvents', { jobId: 'job-1', afterSeq: -1 })).toThrow(/afterSeq/i);
    expect(() => buildMcpJobCommand('JobEvents', { jobId: 'job-1', limit: 0 })).toThrow(/limit/i);
  });

  it.each(['--help', '--wait', '-h'])('rejects option-like workflow kind %s before spawning', kind => {
    expect(() => buildMcpJobCommand('JobSubmit', { kind, payload: {} })).toThrow(/option/i);
  });

  it.each(['JobStatus', 'JobResult', 'JobEvents', 'JobCancel'])('rejects option-like IDs for %s', name => {
    expect(() => buildMcpJobCommand(name, { jobId: '--help' })).toThrow(/option/i);
  });
});
