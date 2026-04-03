import { describe, it, expect } from 'vitest';
import { isDangerousCommand, isReadOnlyCommand, isPathUnderCwd, checkBashPermission, checkFileReadPermission, checkFileWritePermission } from '@agon/core';
import type { ToolContext } from '@agon/core';

function makeCtx(overrides?: Partial<ToolContext>): ToolContext {
  return {
    cwd: '/home/user/project',
    readFileState: new Map(),
    permissionMode: 'ask',
    ...overrides,
  } as ToolContext;
}

describe('tool-permissions', () => {
  describe('isDangerousCommand', () => {
    it('blocks rm -rf /', () => expect(isDangerousCommand('rm -rf /')).toBe(true));
    it('blocks sudo', () => expect(isDangerousCommand('sudo rm file')).toBe(true));
    it('blocks fork bomb', () => expect(isDangerousCommand(':(){:|:&};:')).toBe(true));
    it('allows safe commands', () => expect(isDangerousCommand('ls -la')).toBe(false));
    it('allows npm test', () => expect(isDangerousCommand('npm test')).toBe(false));
  });

  describe('isReadOnlyCommand', () => {
    it('recognizes ls', () => expect(isReadOnlyCommand('ls -la')).toBe(true));
    it('recognizes git status', () => expect(isReadOnlyCommand('git status')).toBe(true));
    it('recognizes npm test', () => expect(isReadOnlyCommand('npm test')).toBe(true));
    it('rejects npm install', () => expect(isReadOnlyCommand('npm install')).toBe(false));
    it('rejects rm', () => expect(isReadOnlyCommand('rm file.txt')).toBe(false));
    it('handles pipe chains of safe commands', () => {
      expect(isReadOnlyCommand('cat file.txt | grep pattern')).toBe(true);
    });
    it('rejects standalone unsafe command', () => {
      expect(isReadOnlyCommand('npm install express')).toBe(false);
    });
  });

  describe('isPathUnderCwd', () => {
    it('allows relative path', () => expect(isPathUnderCwd('src/app.ts', '/home/user/project')).toBe(true));
    it('allows absolute under cwd', () => expect(isPathUnderCwd('/home/user/project/src/app.ts', '/home/user/project')).toBe(true));
    it('rejects path outside cwd', () => expect(isPathUnderCwd('/etc/passwd', '/home/user/project')).toBe(false));
    it('rejects .. traversal', () => expect(isPathUnderCwd('../../etc/passwd', '/home/user/project')).toBe(false));
  });

  describe('checkBashPermission', () => {
    it('denies dangerous commands', () => {
      const result = checkBashPermission('rm -rf /', makeCtx());
      expect(result.behavior).toBe('deny');
    });

    it('allows read-only commands', () => {
      const result = checkBashPermission('git status', makeCtx());
      expect(result.behavior).toBe('allow');
    });

    it('asks for unknown commands', () => {
      const result = checkBashPermission('npm install express', makeCtx());
      expect(result.behavior).toBe('ask');
    });

    it('allows everything in auto mode', () => {
      const result = checkBashPermission('npm install express', makeCtx({ permissionMode: 'auto' }));
      expect(result.behavior).toBe('allow');
    });

    it('denies dangerous even in auto mode', () => {
      const result = checkBashPermission('rm -rf /', makeCtx({ permissionMode: 'auto' }));
      expect(result.behavior).toBe('deny');
    });
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
