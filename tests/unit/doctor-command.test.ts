import { describe, expect, it } from 'vitest';

import {
  buildHarnessDoctorReport,
  buildDoctorCleanupCommand,
  diagnoseEngineDoctorEntry,
  shellQuoteForDoctor,
} from '../../packages/cli/src/generated/commands/doctor.js';

describe('doctor command helpers', () => {
  it('quotes cleanup paths safely', () => {
    expect(shellQuoteForDoctor('/tmp/agon run')).toBe("'/tmp/agon run'");
    expect(buildDoctorCleanupCommand('/repo/root', '/tmp/agon run')).toBe("git -C /repo/root worktree prune && rm -rf '/tmp/agon run'");
  });

  it('flags missing API-only engines as failed', () => {
    delete process.env.AGON_DOCTOR_TEST_KEY_MISSING;
    const entry = diagnoseEngineDoctorEntry({
      id: 'api-only-test',
      displayName: 'API Test',
      schemaVersion: 3,
      isLocal: false,
      tier: 'user',
      timeout: 30,
      api: {
        baseUrl: 'https://example.invalid/v1',
        apiKeyEnv: 'AGON_DOCTOR_TEST_KEY_MISSING',
        model: 'test-model',
        format: 'openai',
      },
    } as any, { findBinary: () => null } as any, ['api-only-test']);

    expect(entry.status).toBe('fail');
    expect(entry.detail).toContain('AGON_DOCTOR_TEST_KEY_MISSING');
    expect(entry.enabled).toBe(true);
  });

  it('stays ok when CLI auth works and the API key is just an unused fallback', () => {
    delete process.env.AGON_DOCTOR_TEST_KEY_MISSING;
    const entry = diagnoseEngineDoctorEntry({
      id: 'hybrid-test',
      displayName: 'Hybrid Test',
      schemaVersion: 3,
      binary: 'hybrid',
      isLocal: false,
      tier: 'user',
      timeout: 30,
      exec: { args: [], stdin: true },
      api: {
        baseUrl: 'https://example.invalid/v1',
        apiKeyEnv: 'AGON_DOCTOR_TEST_KEY_MISSING',
        model: 'test-model',
        format: 'openai',
      },
    } as any, { findBinary: () => '/usr/local/bin/hybrid' } as any, []);

    // CLI auth carries the engine (codex/claude pattern). The unset API key is
    // an optional fallback, not a problem — warning here is noise that scares
    // users off the engines that work most reliably.
    expect(entry.status).toBe('ok');
    expect(entry.backend).toContain('cli:/usr/local/bin/hybrid');
    expect(entry.backend).toContain('(key optional)');
    expect(entry.detail).toContain('CLI auth active (AGON_DOCTOR_TEST_KEY_MISSING optional)');
    expect(entry.detail).not.toContain('not set');
  });

  it('still warns when the API key is missing and there is no CLI fallback', () => {
    delete process.env.AGON_DOCTOR_TEST_KEY_MISSING;
    const entry = diagnoseEngineDoctorEntry({
      id: 'api-only-test',
      displayName: 'API Only Test',
      schemaVersion: 3,
      isLocal: false,
      tier: 'user',
      timeout: 30,
      exec: { args: [], stdin: true },
      api: {
        baseUrl: 'https://example.invalid/v1',
        apiKeyEnv: 'AGON_DOCTOR_TEST_KEY_MISSING',
        model: 'test-model',
        format: 'openai',
      },
    } as any, { findBinary: () => null } as any, ['api-only-test']);

    expect(entry.status).toBe('fail');
    expect(entry.detail).toContain('set AGON_DOCTOR_TEST_KEY_MISSING');
  });

  it('reports Kimi Code missing binary without requiring live auth', () => {
    const entry = diagnoseEngineDoctorEntry({
      id: 'kimi-code',
      displayName: 'Kimi Code',
      schemaVersion: 3,
      binary: 'kimi',
      isLocal: false,
      tier: 'builtin',
      timeout: 180,
      installHint: 'curl -fsSL https://code.kimi.com/kimi-code/install.sh | bash',
      exec: { args: ['--output-format', 'text', '-p', '{prompt}'] },
      agent: { args: ['--output-format', 'text', '-p', '{prompt}'] },
      companion: { protocol: 'acp', serverCmd: ['acp'] },
    } as any, { findBinary: () => null } as any, ['kimi-code']);

    expect(entry.status).toBe('fail');
    expect(entry.backend).toBe('cli missing:kimi');
    expect(entry.modes).toBe('exec, agent, companion');
    expect(entry.detail).toContain('install kimi');
    expect(entry.detail).toContain('forge-enabled');
    expect(entry.detail).toContain('companion:acp');
  });

  it('builds a harness doctor report for the selected Cesar engine', () => {
    const registry = {
      get: (id: string) => ({
        id,
        displayName: 'Claude',
        schemaVersion: 3,
        binary: 'claude',
        exec: { args: [], stdin: true },
        agent: { args: [], stdin: true },
        companion: { protocol: 'mcp' },
        api: {
          model: 'opus-test', apiKeyEnv: 'TEST_KEY', baseUrl: 'https://example.invalid',
          firstChunkTimeoutMs: 120000, idleTimeoutMs: 180000,
          firstChunkRetryCount: 1, firstChunkRetryBackoffMs: 1000,
        },
      }),
      findBinary: () => '/usr/local/bin/claude',
    } as any;

    const report = buildHarnessDoctorReport(
      registry,
      { cesarEngine: 'claude', cesarBackend: 'auto' },
      { hasNativeTools: true },
    );

    expect(report.headers).toEqual(['Check', 'Subject', 'Status', 'Detail']);
    expect(report.rows.some((row) => row[0] === 'Capability profile' && row[3].includes('agent'))).toBe(true);
    expect(report.rows.some((row) => row[0] === 'Native tools' && row[2] === 'ok')).toBe(true);
    expect(report.rows.some((row) => row[0] === 'MCP side-channel' && row[2] === 'warn')).toBe(true);
    expect(report.rows.some((row) => row[0] === 'Latency policy' && row[3].includes('first=120s') && row[3].includes('retry=1'))).toBe(true);
    expect(report.summary).toContain('warn');
  });
});
