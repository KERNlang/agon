import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CommandContribution, InvocationContext, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { createMod } from './implementation.js';

function repo(): string { const cwd = mkdtempSync(join(tmpdir(), 'agon-team-forge-')); execFileSync('git', ['init'], { cwd }); execFileSync('git', ['config', 'user.email', 'team@example.invalid'], { cwd }); execFileSync('git', ['config', 'user.name', 'Team Test'], { cwd }); writeFileSync(join(cwd, 'README.md'), 'fixture\n'); execFileSync('git', ['add', '.'], { cwd }); execFileSync('git', ['commit', '-m', 'base'], { cwd }); return cwd; }

describe('physical Team Forge mod', () => {
  it('runs both architect-to-implementer teams and chooses a fitness-passing team', async () => {
    const cwd = repo();
    const dispatch = vi.fn(async (engineId: string, prompt: string, context: InvocationContext, options: { mode?: string }) => {
      if (prompt.includes('AGON_FORGE_HEALTHY')) return { engineId, exitCode: 0, stdout: 'AGON_FORGE_HEALTHY', stderr: '', timedOut: false };
      if (options.mode === 'agent' && engineId === 'alpha') writeFileSync(join(context.cwd, 'solved.txt'), 'yes\n');
      if (options.mode === 'agent' && engineId === 'beta') writeFileSync(join(context.cwd, 'attempt.txt'), 'no\n');
      return { engineId, exitCode: 0, stdout: prompt.includes('architect') ? 'Create solved.txt and verify it.' : 'ok', stderr: '', timedOut: false };
    });
    const record = vi.fn(async () => 'team-receipt');
    const services = { identity: { id: 'agon.team-forge', version: '1', contentHash: `sha256:${'a'.repeat(64)}` }, source: 'bundled', logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() }, receipts: { record }, permissions: { check: vi.fn() }, state: { read: vi.fn(), write: vi.fn() }, engines: { listActive: vi.fn(async () => ['alpha', 'beta']), rank: vi.fn(async (ids: readonly string[]) => ids.map((engineId) => ({ engineId, reason: 'none', scope: null }))), dispatch } } as unknown as ModServices;
    let command: CommandContribution | undefined;
    const registrar = { command: (surface: string, value: CommandContribution) => { if (surface === 'cli') command = value; return () => {}; }, intent: () => () => {}, tool: () => () => {}, planStep: () => () => {} } as unknown as Registrar;
    const mod = await createMod(services); await mod.activate(registrar, services);
    const context = { invocationId: 'team', cwd, platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {} };
    const output = await command!.run({ task: 'make solved.txt', test: 'test -f solved.txt', engines: 'alpha,beta', members: '2' }, context) as { exitCode: number; stdout: string };
    const result = JSON.parse(output.stdout);
    expect(output.exitCode).toBe(0);
    expect(result).toMatchObject({ winnerTeamId: 'ALPHA', winningEngineId: 'alpha', receiptId: 'team-receipt' });
    expect(result.submissions).toHaveLength(2);
    expect(dispatch.mock.calls.some((call) => call[3]?.mode === 'agent')).toBe(true);
  });
});
