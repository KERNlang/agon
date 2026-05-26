import { describe, it, expect } from 'vitest';
import { createCesarMemory } from '../../packages/core/src/generated/cesar/memory.js';

describe('CesarMemory.toPromptContext', () => {
  it('is empty when nothing has been remembered', () => {
    const mem = createCesarMemory();
    expect(mem.toPromptContext()).toBe('');
  });

  it('renders category + value only, never the internal id key', () => {
    const mem = createCesarMemory();
    mem.remember('turn:1779800000000', 'split brain.kern into modules', 'decision');
    const ctx = mem.toPromptContext();
    expect(ctx).toContain('## SESSION MEMORY (this conversation)');
    expect(ctx).toContain('- [decision] split brain.kern into modules');
    // The noisy timestamp key must NOT leak into the model-facing digest.
    expect(ctx).not.toContain('turn:1779800000000');
  });

  it('surfaces multiple categories and updates a key in place', () => {
    const mem = createCesarMemory();
    mem.remember('turn:1', 'decided to split brain.kern', 'decision');
    mem.remember('tools:1', 'Cesar used tools for: modularization', 'file');
    let ctx = mem.toPromptContext();
    expect(ctx).toContain('- [decision] decided to split brain.kern');
    expect(ctx).toContain('- [file] Cesar used tools for: modularization');
    // Same key overwrites (no duplicate accumulation).
    mem.remember('turn:1', 'decided to split dispatch.kern instead', 'decision');
    ctx = mem.toPromptContext();
    expect(ctx).toContain('decided to split dispatch.kern instead');
    expect(ctx).not.toContain('decided to split brain.kern');
  });
});
