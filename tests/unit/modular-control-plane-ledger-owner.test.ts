
import { mkdtempSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('recovers pending claims through the built owner after a process restart', () => {
  const home = mkdtempSync(join(tmpdir(), 'agon-ledger-owner-'));
  const moduleUrl = new URL('../../packages/support-persistence/dist/index.js', import.meta.url).href;
  const env = { ...process.env, AGON_HOME: home };
  const run = (code: string) => execFileSync(process.execPath, ['--input-type=module', '-e', code], {
    env, encoding: 'utf8', timeout: 10_000,
  });
  try {
    const written = run(`
      import { appendControlPlaneEvent } from ${JSON.stringify(moduleUrl)};
      const envelope = { schemaVersion: 1, sessionId: 'restart', turnId: 't1', leaseEpoch: 7, attempt: 1, producerId: 'fixture' };
      const results = [
        appendControlPlaneEvent('restart', { type: 'tool_claimed', envelope, toolCallId: 'pending-write', effectClass: 'mutation' }),
        appendControlPlaneEvent('restart', { type: 'tool_claimed', envelope, toolCallId: 'pending-read', effectClass: 'read_only' }),
      ];
      console.log(JSON.stringify(results));
    `);
    expect(JSON.parse(written)).toEqual([{ ok: true, seq: 1 }, { ok: true, seq: 2 }]);
    const recovered = run(`
      import { recoverControlPlane, appendControlPlaneEvent } from ${JSON.stringify(moduleUrl)};
      console.log(JSON.stringify({
        recovery: recoverControlPlane('restart'),
        terminal: appendControlPlaneEvent('restart', { type: 'turn_started', envelope: { schemaVersion: 1, leaseEpoch: 8 } }),
      }));
    `);
    expect(JSON.parse(recovered)).toEqual({
      recovery: { nextLeaseEpoch: 8, needsInspection: ['pending-write'], retryableReadOnly: ['pending-read'], unsupportedSchema: false },
      terminal: { ok: true, seq: 3 },
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
