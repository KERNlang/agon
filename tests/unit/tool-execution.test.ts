import { describe, it, expect } from 'vitest';
import { ToolRegistry, executeToolCall, FileStateCache, createReadTool, createGrepTool, createGlobTool } from '@agon/core';
import type { ToolContext, ToolCall, ToolHandler } from '@agon/core';
import { join } from 'node:path';

function makeCtx(cwd?: string): ToolContext {
  const cache = new FileStateCache();
  return {
    cwd: cwd ?? process.cwd(),
    readFileState: (cache as any).cache,
    permissionMode: 'auto',
  } as ToolContext;
}

describe('tool-execution', () => {
  describe('ToolRegistry', () => {
    it('registers and retrieves tools', () => {
      const registry = new ToolRegistry();
      const readTool = createReadTool();
      registry.register(readTool);
      expect(registry.has('Read')).toBe(true);
      expect(registry.get('Read')).toBe(readTool);
      expect(registry.names()).toContain('Read');
    });

    it('lists all tool definitions', () => {
      const registry = new ToolRegistry();
      registry.register(createReadTool());
      registry.register(createGrepTool());
      const defs = registry.list();
      expect(defs).toHaveLength(2);
      expect(defs.map(d => d.name)).toContain('Read');
      expect(defs.map(d => d.name)).toContain('Grep');
    });
  });

  describe('FileStateCache', () => {
    it('stores and retrieves file state', () => {
      const cache = new FileStateCache();
      cache.set('/test/file.ts', { content: 'hello', timestamp: Date.now(), offset: undefined, limit: undefined });
      expect(cache.has('/test/file.ts')).toBe(true);
      const state = cache.get('/test/file.ts');
      expect(state?.content).toBe('hello');
    });

    it('detects staleness', () => {
      const cache = new FileStateCache();
      const old = Date.now() - 10000;
      cache.set('/test/file.ts', { content: 'old', timestamp: old, offset: undefined, limit: undefined });
      expect(cache.isStale('/test/file.ts', Date.now())).toBe(true);
      expect(cache.isStale('/test/file.ts', old - 1)).toBe(false);
    });

    it('tracks partial views', () => {
      const cache = new FileStateCache();
      cache.set('/test/file.ts', { content: 'partial', timestamp: Date.now(), offset: 0, limit: 50, isPartialView: true });
      expect(cache.wasReadFully('/test/file.ts')).toBe(false);
    });

    it('evicts when over limit', () => {
      const cache = new FileStateCache();
      for (let i = 0; i < 105; i++) {
        cache.set(`/test/file${i}.ts`, { content: `content${i}`, timestamp: Date.now(), offset: undefined, limit: undefined });
      }
      expect(cache.size()).toBeLessThanOrEqual(100);
    });
  });

  describe('executeToolCall', () => {
    it('returns error for unknown tool', async () => {
      const registry = new ToolRegistry();
      const call: ToolCall = { id: 'tc_1', name: 'NonExistent', input: {} };
      const result = await executeToolCall(call, makeCtx(), registry);
      expect(result.result.ok).toBe(false);
      expect(result.result.error).toContain('Unknown tool');
    });

    it('executes Read tool on existing file', async () => {
      const registry = new ToolRegistry();
      registry.register(createReadTool());
      const call: ToolCall = { id: 'tc_1', name: 'Read', input: { file_path: 'package.json' } };
      const result = await executeToolCall(call, makeCtx(), registry);
      expect(result.result.ok).toBe(true);
      expect(result.result.content).toContain('agon');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('returns error for non-existent file', async () => {
      const registry = new ToolRegistry();
      registry.register(createReadTool());
      const call: ToolCall = { id: 'tc_1', name: 'Read', input: { file_path: 'nonexistent-file-12345.ts' } };
      const result = await executeToolCall(call, makeCtx(), registry);
      expect(result.result.ok).toBe(false);
      expect(result.result.error).toContain('not found');
    });

    it('executes Grep tool for known pattern', async () => {
      const registry = new ToolRegistry();
      registry.register(createGrepTool());
      const call: ToolCall = { id: 'tc_1', name: 'Grep', input: { pattern: 'vitest', path: 'package.json', output_mode: 'content' } };
      const result = await executeToolCall(call, makeCtx(), registry);
      expect(result.result.ok).toBe(true);
      expect(result.result.content).toContain('vitest');
    });

    it('propagates string denials from the permission handler', async () => {
      const { ToolRegistry: GeneratedToolRegistry, executeToolCall: generatedExecuteToolCall } = await import('../../packages/core/src/generated/signals/tool-registry.js');
      const registry = new GeneratedToolRegistry();
      const tool: ToolHandler = {
        definition: {
          name: 'AskTool',
          description: 'asks for permission',
          inputSchema: { type: 'object', properties: {}, required: [] },
          maxResultSizeChars: 1000,
          isReadOnly: false,
          isConcurrencySafe: true,
        },
        validate: () => null,
        checkPermission: () => ({ behavior: 'ask', message: 'Need approval' }),
        execute: async () => ({ ok: true, content: 'ran' }),
      };
      registry.register(tool);
      const call: ToolCall = { id: 'tc_ask', name: 'AskTool', input: {} };
      const result = await generatedExecuteToolCall(call, makeCtx(), registry, async () => 'BLOCKED: test denial');
      expect(result.result.ok).toBe(false);
      expect(result.result.error).toBe('BLOCKED: test denial');
    });
  });
});
