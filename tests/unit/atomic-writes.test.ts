import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { saveSessionState, loadSessionState, clearSessionState, saveToolResultToDisk } from '@agon/core';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

const TEST_ENGINE = `test-atomic-${Date.now()}`;

describe('session-store — atomic writes', () => {
  let testHome = '';

  beforeEach(() => {
    testHome = setupTestAgonHome('atomic-writes');
  });

  afterEach(() => {
    try { clearSessionState(TEST_ENGINE); } catch { /* may not exist */ }
    cleanupTestAgonHome(testHome);
  });

  it('saveSessionState writes to disk without corruption', () => {
    const state = {
      messageHistory: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi there' },
      ],
      confidence: 0.9,
    };

    saveSessionState(TEST_ENGINE, state);

    const loaded = loadSessionState(TEST_ENGINE);
    expect(loaded).not.toBeNull();
    expect(loaded!.messageHistory).toHaveLength(2);
    expect(loaded!.messageHistory[0].content).toBe('hello');
    expect(loaded!.confidence).toBe(0.9);
  });

  it('saveSessionState preserves data on successive writes', () => {
    const state1 = {
      messageHistory: [{ role: 'user', content: 'first' }],
      confidence: 0.5,
    };
    const state2 = {
      messageHistory: [
        { role: 'user', content: 'first' },
        { role: 'assistant', content: 'second' },
      ],
      confidence: 0.8,
    };

    saveSessionState(TEST_ENGINE, state1);
    saveSessionState(TEST_ENGINE, state2);

    const loaded = loadSessionState(TEST_ENGINE);
    expect(loaded).not.toBeNull();
    expect(loaded!.messageHistory).toHaveLength(2);
    expect(loaded!.confidence).toBe(0.8);
  });

  it('saveToolResultToDisk returns manifest entry with correct metadata', () => {
    const content = 'Large tool result content for testing atomic write.\n'.repeat(10);
    const entry = saveToolResultToDisk(TEST_ENGINE, 'call_atomic_1', 'Read', content);

    expect(entry).not.toBeNull();
    expect(entry!.toolCallId).toBe('call_atomic_1');
    expect(entry!.toolName).toBe('Read');
    expect(entry!.byteSize).toBe(Buffer.byteLength(content, 'utf-8'));
    expect(entry!.filePath).toContain('call_atomic_1.txt');
  });
});
