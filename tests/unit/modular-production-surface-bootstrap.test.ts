import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  DurableModHost,
  createFirstPartyModCatalog,
  createFullCompatDesiredState,
  planDesiredStateChange,
} from '../../packages/mod-kernel/src/index.js';
import { surfaceLockFor } from '../helpers/modular-surface-lock.js';
import {
  assertProcessSurfaceAvailable,
  disposeProcessSurfaceAuthority,
  initializeProcessSurfaceAuthority,
  processSurfaceClient,
  processSurfacePublicIds,
} from '../../packages/cli/src/surface-authority-runtime.js';

const NOW = '2026-08-23T20:00:00.000Z';
afterEach(async () => {
  await disposeProcessSurfaceAuthority();
});

describe('production physical surface bootstrap', () => {
  it('activates all physical first-party packages when no durable state exists and detects a new pointer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s6-production-default-'));
    await initializeProcessSurfaceAuthority(join(root, 'absent-host'));
    expect(processSurfaceClient('cli').generation).toBe('generated:first-party-full-compat');
    expect(processSurfacePublicIds('cli')).toContain('brainstorm');
    assertProcessSurfaceAvailable('mcp', 'Brainstorm');

    const pointerPath = join(root, 'absent-host', 'current-generation.json');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(join(root, 'absent-host'), { recursive: true }));
    await writeFile(pointerPath, '{}\n');
    expect(() => processSurfacePublicIds('cli')).toThrow(/changed/);
  });

  it('uses the validated durable desired state and makes a disabled owner unreachable on all five surfaces', async () => {
    const root = await mkdtemp(join(tmpdir(), 'agon-s6-production-disabled-'));
    const catalog = createFirstPartyModCatalog();
    const full = createFullCompatDesiredState(catalog, NOW);
    const desired = planDesiredStateChange(catalog, full, { kind: 'disable', id: 'agon.brainstorm' }, '2026-08-23T20:00:01.000Z').nextState;
    const host = new DurableModHost(root, { kernelVersion: '1.0.0', processIdentity: 's6-production-test' });
    await host.commitGeneration({ operation: 'disable', lock: await surfaceLockFor(desired), desiredState: desired, installedIndex: {} });

    await initializeProcessSurfaceAuthority(root);
    expect(processSurfaceClient('cli').generation).toContain('generated:1:');
    for (const [surface, publicId] of [
      ['cli', 'brainstorm'], ['tui', '/brainstorm'], ['mcp', 'Brainstorm'], ['cesar', 'brainstorm'],
    ] as const) {
      expect(() => assertProcessSurfaceAvailable(surface, publicId)).toThrow(/unavailable/);
    }
    expect(processSurfaceClient('docs').project().entries.some(({ owner }) => owner.id === 'agon.brainstorm')).toBe(false);
  });
});
