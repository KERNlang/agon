import { describe, it, expect } from 'vitest';
import { ToolRegistry, executeToolCall, FileStateCache, createReadTool, createGrepTool, createGlobTool } from '@agon/core';
import type { ToolContext, ToolCall, ToolHandler } from '@agon/core';
import { join } from 'node:path';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { getProjectFileStateCache, clearProjectFileStateCaches } from '../../packages/core/src/generated/blocks/file-state-cache.js';
import { ToolRegistry as GeneratedToolRegistry, executeToolCall as generatedExecuteToolCall } from '../../packages/core/src/generated/signals/tool-registry.js';
import { createReadTool as generatedCreateReadTool } from '../../packages/core/src/generated/tools/tool-read.js';
import { createEditTool as generatedCreateEditTool } from '../../packages/core/src/generated/tools/tool-edit.js';

const REPO_ROOT = join(import.meta.dirname, '../..');

function makeCtx(cwd?: string): ToolContext {
  const cache = new FileStateCache();
  return {
    cwd: cwd ?? REPO_ROOT,
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

    it('evicts when callers write through the exposed raw map', () => {
      const cache = new FileStateCache();
      const exposed = (cache as any).cache as Map<string, any>;
      for (let i = 0; i < 105; i++) {
        exposed.set(`/test/raw-file${i}.ts`, {
          content: `content${i}`,
          timestamp: Date.now(),
          offset: undefined,
          limit: undefined,
        });
      }
      expect(cache.size()).toBeLessThanOrEqual(100);
      expect(exposed.size).toBeLessThanOrEqual(100);
    });

    it('project cache preserves read-before-write state across tool contexts', async () => {
      clearProjectFileStateCaches();
      const cwd = mkdtempSync(join(tmpdir(), 'agon-project-cache-'));
      const filePath = join(cwd, 'sample.ts');
      writeFileSync(filePath, 'const value = 1;\n');

      const registry = new GeneratedToolRegistry();
      registry.register(generatedCreateReadTool());
      registry.register(generatedCreateEditTool());

      const readCache = getProjectFileStateCache(cwd);
      const readCtx = { cwd, readFileState: (readCache as any).cache, permissionMode: 'auto' } as ToolContext;
      const readResult = await generatedExecuteToolCall({ id: 'read_1', name: 'Read', input: { file_path: 'sample.ts' } }, readCtx, registry);
      expect(readResult.result.ok).toBe(true);

      const editCache = getProjectFileStateCache(cwd);
      const editCtx = { cwd, readFileState: (editCache as any).cache, permissionMode: 'auto' } as ToolContext;
      const editResult = await generatedExecuteToolCall(
        { id: 'edit_1', name: 'Edit', input: { file_path: 'sample.ts', old_string: 'value = 1', new_string: 'value = 2' } },
        editCtx,
        registry,
      );

      expect(editResult.result.ok).toBe(true);
      expect(readFileSync(filePath, 'utf-8')).toContain('value = 2');
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

    it('returns an error for tools blocked by the execution context', async () => {
      const registry = new ToolRegistry();
      let executed = false;
      const tool: ToolHandler = {
        definition: {
          name: 'Forge',
          description: 'signal tool',
          inputSchema: { type: 'object', properties: {}, required: [] },
          maxResultSizeChars: 1000,
          isReadOnly: true,
          isConcurrencySafe: true,
        },
        validate: () => null,
        checkPermission: () => ({ behavior: 'allow' }),
        execute: async () => {
          executed = true;
          return { ok: true, content: 'delegated' };
        },
      };
      registry.register(tool);

      const result = await executeToolCall(
        { id: 'tc_blocked', name: 'Forge', input: {} },
        { ...makeCtx(), blockedTools: ['Forge'], blockedToolMessage: 'Blocked by fast-answer' },
        registry,
      );

      expect(result.result.ok).toBe(false);
      expect(result.result.error).toBe('Blocked by fast-answer');
      expect(executed).toBe(false);
    });
  });
});
