import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { InvocationContext, ModServices } from '@kernlang/agon-mod-api';
import { saveMemory } from './implementation.js';

let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'memory-contract-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const controller = new AbortController();
  const context: InvocationContext = { invocationId: 'memory-test', cwd: root, platform: 'darwin-arm64', signal: controller.signal, config: {}, didWriteFile: vi.fn() };
  const services = { permissions: { check: vi.fn(async () => 'allow' as const) } } as unknown as ModServices;
  return { context, controller, services, path: join(root, '.agon', 'project.md') };
}

describe('physical project-memory mod', () => {
  it('preserves project content, deduplicates facts, and does not change engine notes', async () => {
    const { context, services, path } = fixture();
    mkdirSync(join(root, '.agon'));
    writeFileSync(path, '# Project\nfitness: npm test\n');
    const engineNotes = join(root, 'engine-memory.json');
    writeFileSync(engineNotes, '{"existing":"routing evidence"}\n');
    const before = readFileSync(engineNotes);
    const input = { memory: 'Use session tokens', section: 'Decisions' };
    expect(await saveMemory(input, context, services)).toContain('Saved to project memory [Decisions]');
    const saved = readFileSync(path, 'utf8');
    expect(saved).toContain('fitness: npm test');
    expect(saved).toMatch(/- \d{4}-\d{2}-\d{2} Use session tokens/);
    expect(await saveMemory({ ...input, memory: 'use   SESSION tokens' }, context, services)).toContain('near-duplicate');
    expect(readFileSync(path, 'utf8')).toBe(saved);
    expect(readFileSync(engineNotes)).toEqual(before);
    expect(context.didWriteFile).toHaveBeenCalledTimes(1);
  });

  it('requires a write grant for the resolved project-memory path', async () => {
    const { context, services, path } = fixture();
    const check = vi.fn(async () => 'deny' as const);
    await expect(saveMemory({ memory: 'fact', section: 'Decisions' }, context, { ...services, permissions: { check } })).rejects.toThrow('Permission denied');
    expect(check).toHaveBeenCalledWith('fs.write', path);
    expect(existsSync(path)).toBe(false);
  });

  it('does not write when cancellation occurs during the permission check', async () => {
    const { context, controller, services, path } = fixture();
    const check = async () => { controller.abort(); return 'allow' as const; };
    await expect(saveMemory({ memory: 'fact', section: 'Decisions' }, context, { ...services, permissions: { check } })).rejects.toThrow();
    expect(existsSync(path)).toBe(false);
  });

  it('rechecks invocation authority after the permission result', async () => {
    const { context, services, path } = fixture();
    let current = true;
    const check = async () => { current = false; return 'allow' as const; };
    const assertCurrent = () => { if (!current) throw new Error('generation replaced'); };
    await expect(saveMemory({ memory: 'fact', section: 'Decisions' }, { ...context, assertCurrent },
      { ...services, permissions: { check } })).rejects.toThrow('generation replaced');
    expect(existsSync(path)).toBe(false);
  });

  it('retains the section cap without touching unrelated sections', async () => {
    const { context, services, path } = fixture();
    mkdirSync(join(root, '.agon'));
    writeFileSync(path, '## Decisions\n' + Array.from({ length: 30 }, (_, i) => '- 2026-01-01 fact ' + i).join('\n') + '\n\n## Constraints\n- keep this\n');
    expect(await saveMemory({ memory: 'new fact', section: 'Decisions' }, context, services)).toContain('oldest entry dropped');
    const saved = readFileSync(path, 'utf8');
    expect(saved).not.toContain('fact 0\n');
    expect(saved).toContain('fact 29\n');
    expect(saved).toContain('## Constraints\n- keep this\n');
  });
});
