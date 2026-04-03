import { describe, it, expect, afterEach } from 'vitest';
import { createSidechainLogger } from '../../packages/core/src/generated/sidechain-logger.js';
import { readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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
