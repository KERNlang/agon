import { describe, it, expect, afterEach } from 'vitest';
import { createSidechainLogger } from '../../packages/mod-kernel/src/sidechain-logger.js';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

it('preserves the exact legacy logger implementation from 22fbc4f3', () => {
  const source = readFileSync(new URL('../../packages/mod-kernel/src/sidechain-logger.ts', import.meta.url));
  expect(createHash('sha256').update(source).digest('hex')).toBe('266abce83c450811a018c767942cd9184d528fd60ab05ffd156c5d07ede06bd8');
});

it('has one physical kernel owner and no legacy core implementation', () => {
  expect(existsSync(new URL('../../packages/core/src/blocks/sidechain-logger.ts', import.meta.url))).toBe(false);
  const core = readFileSync(new URL('../../packages/core/src/index.ts', import.meta.url), 'utf8');
  expect(core).toContain("export { createSidechainLogger } from '@kernlang/agon-kernel'");
});

describe('SidechainLogger', () => {
  const testDir = join(tmpdir(), `sidechain-test-${Date.now()}`);

  afterEach(() => {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
  });

  it('creates JSONL file with correct name', () => {
    const logger = createSidechainLogger({
      sessionId: 'abc123',
      sessionType: 'forge',
      outputDir: testDir,
    });
    logger.log('test:event');
    expect(existsSync(logger.path)).toBe(true);
    expect(logger.path).toContain('forge_abc123.jsonl');
  });

  it('writes valid JSONL events', () => {
    const logger = createSidechainLogger({
      sessionId: 'test1',
      sessionType: 'tribunal',
      outputDir: testDir,
    });
    logger.log('round:start', 'claude', { round: 1 });
    logger.log('round:end', 'codex');

    const content = readFileSync(logger.path, 'utf-8');
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);

    const event1 = JSON.parse(lines[0]);
    expect(event1.type).toBe('round:start');
    expect(event1.engineId).toBe('claude');
    expect(event1.data.round).toBe(1);
    expect(event1.sessionType).toBe('tribunal');
    expect(event1.ts).toBeTruthy();
  });

  it('child creates nested sidechain file', () => {
    const parent = createSidechainLogger({
      sessionId: 'parent1',
      sessionType: 'forge',
      outputDir: testDir,
    });
    const child = parent.child('child1', 'synthesis');
    child.log('critique:start');

    expect(child.path).toContain('sidechain_parent1');
    expect(existsSync(child.path)).toBe(true);
  });

  it('omits undefined fields', () => {
    const logger = createSidechainLogger({
      sessionId: 'clean1',
      sessionType: 'brainstorm',
      outputDir: testDir,
    });
    logger.log('bid:received');

    const content = readFileSync(logger.path, 'utf-8');
    const event = JSON.parse(content.trim());
    expect(event.engineId).toBeUndefined();
    expect(event.parentId).toBeUndefined();
    expect(event.data).toBeUndefined();
  });
});
