import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// Generated sources, not the package dist — the dist lags until `npm run build`,
// so package imports here would test STALE code (bit us 2026-07-17).
import { isPathUnderCwd, parsePermissionRuleSet } from '../../packages/core/src/generated/tools/tool-permissions.js';
import { createReadTool } from '../../packages/core/src/generated/tools/tool-read.js';
import { createWriteTool } from '../../packages/core/src/generated/tools/tool-write.js';
import type { ToolContext } from '@kernlang/agon-core';

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    cwd: '/home/user/project',
    readFileState: new Map(),
    permissionMode: 'ask',
    ...overrides,
  } as ToolContext;
}

// These exercise the REAL inline permission gates that run on every execution
// path (executeToolCall → handler.checkPermission). The former standalone
// PermissionChecks.checkFileReadPermission / checkFileWritePermission were
// proven dead (no caller used them) and were deleted; the live semantics now
// live in the tool factories, so the assertions drive those directly.
const readGate = createReadTool().checkPermission!;
const writeGate = createWriteTool().checkPermission!;

describe('tool-permissions', () => {
  describe('isPathUnderCwd', () => {
    it('allows relative path', () => expect(isPathUnderCwd('src/app.ts', '/home/user/project')).toBe(true));
    it('allows absolute under cwd', () => expect(isPathUnderCwd('/home/user/project/src/app.ts', '/home/user/project')).toBe(true));
    it('rejects path outside cwd', () => expect(isPathUnderCwd('/etc/passwd', '/home/user/project')).toBe(false));
    it('rejects .. traversal', () => expect(isPathUnderCwd('../../etc/passwd', '/home/user/project')).toBe(false));
  });

  describe('Read inline gate (createReadTool().checkPermission)', () => {
    it('allows files under cwd', () => {
      const result = readGate({ file_path: 'src/app.ts' }, makeCtx());
      expect(result.behavior).toBe('allow');
    });

    it('ASKS for files outside cwd instead of hard-denying (cross-repo agentic access)', () => {
      const result = readGate({ file_path: '/etc/passwd' }, makeCtx());
      expect(result.behavior).toBe('ask');
      expect(result.reason).toBe('path-outside-cwd');
      expect(result.message).toContain('/etc/passwd');
    });

    it('a persisted allow rule whitelists an outside repo without asking', () => {
      const rules = parsePermissionRuleSet({ allow: ['Read(/home/user/backend:*)'], deny: [] });
      const result = readGate(
        { file_path: '/home/user/backend/src/api.ts' },
        makeCtx({ permissionRules: rules } as any),
      );
      expect(result.behavior).toBe('allow');
    });

    it('a deny rule still wins over the outside-cwd ask', () => {
      const rules = parsePermissionRuleSet({ allow: [], deny: ['Read(/etc:*)'] });
      const result = readGate(
        { file_path: '/etc/passwd' },
        makeCtx({ permissionRules: rules } as any),
      );
      expect(result.behavior).toBe('deny');
    });

    it('a workspace symlink that RESOLVES outside cwd still triggers the ask (no lexical bypass)', () => {
      const base = mkdtempSync(join(tmpdir(), 'agon-symlink-'));
      try {
        const workspace = join(base, 'workspace');
        const outside = join(base, 'outside');
        mkdirSync(workspace);
        mkdirSync(outside);
        writeFileSync(join(outside, 'secret.txt'), 'secret');
        symlinkSync(outside, join(workspace, 'escape'));
        // Lexically workspace/escape/secret.txt is under cwd — canonically it is not.
        const result = readGate({ file_path: 'escape/secret.txt' }, makeCtx({ cwd: workspace }));
        expect(result.behavior).toBe('ask');
        expect(result.reason).toBe('path-outside-cwd');
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    });
  });

  describe('Write inline gate (createWriteTool().checkPermission)', () => {
    it('allows files under cwd', () => {
      const result = writeGate({ file_path: 'src/app.ts' }, makeCtx());
      expect(result.behavior).toBe('allow');
    });

    it('ASKS for files outside cwd instead of hard-denying (cross-repo agentic access)', () => {
      const result = writeGate({ file_path: '/tmp/outside.ts' }, makeCtx());
      expect(result.behavior).toBe('ask');
      expect(result.reason).toBe('path-outside-cwd');
      expect(result.message).toContain('/tmp/outside.ts');
    });
  });
});
