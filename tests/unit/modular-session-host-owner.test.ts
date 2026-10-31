import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as core from '@kernlang/agon-core';
import * as persistence from '@kernlang/agon-support-persistence';

let home: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'session-host-owner-'));
  vi.stubEnv('AGON_HOME', home);
  persistence.resetEventLogState();
});
afterEach(() => {
  persistence.resetEventLogState();
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

describe('Session host physical ownership', () => {
  it('exports one class, factory and singleton through Core and Persistence', () => {
    expect(persistence.getSessionHost).toBeTypeOf('function');
    expect(core.getSessionHost).toBe(persistence.getSessionHost);
    expect(core.InProcessSessionHost).toBe(persistence.InProcessSessionHost);
    expect(core.inProcessSessionHost).toBe(persistence.inProcessSessionHost);
    expect(core.getSessionHost()).toBe(persistence.inProcessSessionHost);
    expect(core.SUBSCRIBE_POLL_MS).toBe(persistence.SUBSCRIBE_POLL_MS);
  });

  it('reads Core events through the owner before they are flushed to disk', () => {
    expect(persistence.getSessionHost).toBeTypeOf('function');
    const event = { type: 'text', content: 'pending event' };
    core.eventLogAppend('unflushed', event);
    expect(existsSync(persistence.eventsPath('unflushed'))).toBe(false);
    const host = persistence.getSessionHost();
    expect(host.latestSeq('unflushed')).toBe(1);
    expect(host.replay('unflushed').map(entry => entry.event)).toEqual([event]);
  });

  it('retires the private Core implementation', () => {
    expect(existsSync(new URL('../../packages/core/src/sessions/session-host.ts', import.meta.url))).toBe(false);
  });

  it.each(['commands/attach.ts', 'bridge/agon-serve.ts'])('uses the public owner in %s', path => {
    const source = readFileSync(new URL(`../../packages/cli/src/${path}`, import.meta.url), 'utf8');
    expect(source).toMatch(/import\s*\{[^}]*getSessionHost[^}]*\}\s*from\s*['"]@kernlang\/agon-support-persistence['"]/);
    expect(source).not.toMatch(/import\s*\{[^}]*getSessionHost[^}]*\}\s*from\s*['"]@kernlang\/agon-core['"]/);
  });
});
