import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  createRetrieveResultTool,
  saveToolResultToDisk,
  clearSessionState,
} from '@kernlang/agon-core';
import type { ToolContext } from '@kernlang/agon-core';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

const TEST_ENGINE = `retrieve-test-${Date.now()}`;

const mockCtx: ToolContext = {
  cwd: process.cwd(),
  readFileState: new Map(),
  abortSignal: new AbortController().signal,
  permissionMode: 'auto',
  explorationMode: false,
  allowedCommands: [],
  toolPermissions: {},
};

describe('RetrieveResult tool', () => {
  let testHome = '';

  beforeEach(() => {
    testHome = setupTestAgonHome('tool-retrieve');
  });

  afterEach(() => {
    try { clearSessionState(TEST_ENGINE); } catch { /* clean */ }
    cleanupTestAgonHome(testHome);
  });

  it('has correct tool definition', () => {
    const tool = createRetrieveResultTool(TEST_ENGINE);
    expect(tool.definition.name).toBe('RetrieveResult');
    expect(tool.definition.isReadOnly).toBe(true);
    expect(tool.definition.inputSchema.required).toContain('id');
  });

  it('validates missing id parameter', () => {
    const tool = createRetrieveResultTool(TEST_ENGINE);
    const error = tool.validate({}, mockCtx);
    expect(error).not.toBeNull();
    expect(error).toContain('id');
  });

  it('validates valid input', () => {
    const tool = createRetrieveResultTool(TEST_ENGINE);
    const error = tool.validate({ id: 'call_123' }, mockCtx);
    expect(error).toBeNull();
  });

  it('retrieves cached tool result', async () => {
    const content = 'This is the full cached content from a previous Read call.';
    saveToolResultToDisk(TEST_ENGINE, 'call_789', 'Read', content);

    const tool = createRetrieveResultTool(TEST_ENGINE);
    const result = await tool.execute({ id: 'call_789' }, mockCtx);

    expect(result.ok).toBe(true);
    expect(result.content).toBe(content);
  });

  it('returns error for missing cache entry', async () => {
    const tool = createRetrieveResultTool(TEST_ENGINE);
    const result = await tool.execute({ id: 'nonexistent_id' }, mockCtx);

    expect(result.ok).toBe(false);
    expect(result.error).toContain('No cached result found');
  });

  it('permission check always allows', () => {
    const tool = createRetrieveResultTool(TEST_ENGINE);
    const decision = tool.checkPermission({ id: 'call_123' }, mockCtx);
    expect(decision.behavior).toBe('allow');
  });
});
