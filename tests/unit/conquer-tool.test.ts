import { describe, it, expect } from 'vitest';
import { createConquerTool } from '../../packages/core/src/generated/blocks/tool-orchestration.js';
import { extractDelegation } from '../../packages/cli/src/generated/cesar/brain-helpers.js';

describe('Conquer tool', () => {
  it('defines a Conquer signal tool requiring task + gate', () => {
    const t = createConquerTool();
    expect(t.definition.name).toBe('Conquer');
    expect(t.definition.isReadOnly).toBe(false);
    expect(t.definition.inputSchema.required).toEqual(expect.arrayContaining(['task', 'gate']));
    // task is validated first, then gate
    expect(t.validate({ gate: 'pnpm test' }, {} as any)).toMatch(/task/i); // missing task
    expect(t.validate({ task: 'build X' }, {} as any)).toMatch(/gate/i); // missing gate (the done-spec)
    expect(t.validate({ task: 'build X', gate: 'pnpm test' }, {} as any)).toBeNull();
    expect(t.validate({ task: 'build X', gate: 'pnpm test', engines: 'nope' }, {} as any)).toMatch(/engines/i);
  });

  it('extractDelegation maps a Conquer tool call to action=conquer, threading builder', () => {
    const d = extractDelegation('Conquer', {
      task: 'build the thing',
      gate: 'pnpm test',
      builder: 'codex',
      engines: ['codex', 'claude'],
      maxTurns: 12,
    });
    expect(d.action).toBe('conquer');
    expect(d.task).toBe('build the thing');
    expect(d.gate).toBe('pnpm test');
    expect(d.builder).toBe('codex');
    expect(d.engines).toEqual(['codex', 'claude']);
    expect(d.maxTurns).toBe(12);
  });

  it('extractDelegation leaves builder undefined when not supplied', () => {
    const d = extractDelegation('Conquer', { task: 'x', gate: 'pnpm test' });
    expect(d.action).toBe('conquer');
    expect(d.builder).toBeUndefined();
  });
});
