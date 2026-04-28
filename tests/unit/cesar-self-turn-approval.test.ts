import { describe, expect, it } from 'vitest';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolContext } from '@agon/core';
import { applyCesarSelfTurnApproval, approvalArgsFromCommand } from '../../packages/cli/src/generated/cesar/self-turn-approval.js';

function makeCtx(cwd: string, filePath: string, content: string, timestamp?: number): ToolContext {
  return {
    cwd,
    readFileState: new Map([
      [filePath, {
        content,
        timestamp: timestamp ?? statSync(filePath).mtimeMs,
        offset: 0,
        limit: 2000,
        isPartialView: false,
      }],
    ]),
    permissionMode: 'ask',
    toolPermissions: { Edit: 'ask', Write: 'ask' },
  } as ToolContext;
}

describe('Cesar self-turn approval', () => {
  it('approves a small edit on a previously read file', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-self-approval-'));
    const filePath = join(cwd, 'src.ts');
    const content = 'export const value = 1;\n';
    writeFileSync(filePath, content);

    const decision = applyCesarSelfTurnApproval(
      'Edit',
      { file_path: filePath, old_string: 'value = 1', new_string: 'value = 2' },
      makeCtx(cwd, filePath, content),
      {},
    );

    expect(decision.approve).toBe(true);
  });

  it('does not approve files that are not in the read cache', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-self-approval-'));
    const filePath = join(cwd, 'src.ts');
    writeFileSync(filePath, 'export const value = 1;\n');
    const ctx = { cwd, readFileState: new Map(), permissionMode: 'ask', toolPermissions: { Edit: 'ask' } } as ToolContext;

    const decision = applyCesarSelfTurnApproval(
      'Edit',
      { file_path: filePath, old_string: '1', new_string: '2' },
      ctx,
      {},
    );

    expect(decision.approve).toBe(false);
    expect(decision.reason).toContain('not read');
  });

  it('does not approve stale cached reads', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-self-approval-'));
    const filePath = join(cwd, 'src.ts');
    const content = 'export const value = 1;\n';
    writeFileSync(filePath, content);

    const decision = applyCesarSelfTurnApproval(
      'Edit',
      { file_path: filePath, old_string: '1', new_string: '2' },
      makeCtx(cwd, filePath, content, 1),
      {},
    );

    expect(decision.approve).toBe(false);
    expect(decision.reason).toContain('changed since last read');
  });

  it('does not approve diffs above the configured threshold', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-self-approval-'));
    const filePath = join(cwd, 'src.ts');
    const content = 'a'.repeat(1000);
    writeFileSync(filePath, content);

    const decision = applyCesarSelfTurnApproval(
      'Write',
      { file_path: filePath, content: 'b'.repeat(1000) },
      makeCtx(cwd, filePath, content),
      { cesarSelfTurnAutoApproveMaxDiffTokens: 10 },
    );

    expect(decision.approve).toBe(false);
    expect(decision.reason).toContain('exceeds');
  });

  it('extracts native approval args from JSON command strings', () => {
    const args = approvalArgsFromCommand('Edit', '{"file_path":"src.ts","old_string":"a","new_string":"b"}');
    expect(args).toMatchObject({ file_path: 'src.ts', old_string: 'a', new_string: 'b' });
  });

  it('approves small native path/oldString/newString approval payloads', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-self-approval-native-'));
    const filePath = join(cwd, 'src.ts');
    const content = 'export const value = 1;\n';
    writeFileSync(filePath, content);

    const decision = applyCesarSelfTurnApproval(
      'Edit',
      { path: filePath, oldString: 'value = 1', newString: 'value = 2' },
      makeCtx(cwd, filePath, content),
      {},
    );

    expect(decision.approve).toBe(true);
  });

  it('approves single nested change payloads when they contain a bounded diff', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'agon-self-approval-change-'));
    const filePath = join(cwd, 'src.ts');
    const content = 'export const value = 1;\n';
    writeFileSync(filePath, content);

    const decision = applyCesarSelfTurnApproval(
      'Edit',
      { changes: [{ path: filePath, old: 'value = 1', new: 'value = 2' }] },
      makeCtx(cwd, filePath, content),
      {},
    );

    expect(decision.approve).toBe(true);
  });
});
