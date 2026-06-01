import { describe, it, expect } from 'vitest';
import { isPathUnderCwd, checkFileReadPermission, checkFileWritePermission } from '@kernlang/agon-core';
import type { ToolContext } from '@kernlang/agon-core';

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    cwd: '/home/user/project',
    readFileState: new Map(),
    permissionMode: 'ask',
    ...overrides,
  } as ToolContext;
}

describe('tool-permissions', () => {
  describe('isPathUnderCwd', () => {
    it('allows relative path', () => expect(isPathUnderCwd('src/app.ts', '/home/user/project')).toBe(true));
    it('allows absolute under cwd', () => expect(isPathUnderCwd('/home/user/project/src/app.ts', '/home/user/project')).toBe(true));
    it('rejects path outside cwd', () => expect(isPathUnderCwd('/etc/passwd', '/home/user/project')).toBe(false));
    it('rejects .. traversal', () => expect(isPathUnderCwd('../../etc/passwd', '/home/user/project')).toBe(false));
  });

  describe('checkFileReadPermission', () => {
    it('allows files under cwd', () => {
      const result = checkFileReadPermission('src/app.ts', makeCtx());
      expect(result.behavior).toBe('allow');
    });

    it('asks for files outside cwd', () => {
      const result = checkFileReadPermission('/etc/passwd', makeCtx());
      expect(result.behavior).toBe('ask');
    });
  });

  describe('checkFileWritePermission', () => {
    it('allows files under cwd', () => {
      const result = checkFileWritePermission('src/app.ts', makeCtx());
      expect(result.behavior).toBe('allow');
    });

    it('asks for sensitive files', () => {
      const result = checkFileWritePermission('.env', makeCtx());
      expect(result.behavior).toBe('ask');
    });

    it('asks for files outside cwd', () => {
      const result = checkFileWritePermission('/tmp/outside.ts', makeCtx());
      expect(result.behavior).toBe('ask');
    });
  });
});
