import { describe, it, expect } from 'vitest';
import { isPathUnderCwd, createReadTool, createWriteTool } from '@kernlang/agon-core';
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

    it('denies files outside cwd', () => {
      const result = readGate({ file_path: '/etc/passwd' }, makeCtx());
      expect(result.behavior).toBe('deny');
      expect(result.message).toContain('outside the working directory');
    });
  });

  describe('Write inline gate (createWriteTool().checkPermission)', () => {
    it('allows files under cwd', () => {
      const result = writeGate({ file_path: 'src/app.ts' }, makeCtx());
      expect(result.behavior).toBe('allow');
    });

    it('denies files outside cwd', () => {
      const result = writeGate({ file_path: '/tmp/outside.ts' }, makeCtx());
      expect(result.behavior).toBe('deny');
      expect(result.message).toContain('outside the working directory');
    });
  });
});
