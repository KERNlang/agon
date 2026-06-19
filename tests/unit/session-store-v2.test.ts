import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

// We need to test the actual functions, but they use AGON_HOME which reads from config.
// Import the generated code directly to test the logic.
import {
  saveToolResultToDisk,
  loadToolResultFromDisk,
  pruneToolCache,
  saveSessionState,
  loadSessionState,
  clearSessionState,
  saveConversation,
  loadConversation,
  clearConversation,
  stripEngineArtifacts,
} from '@kernlang/agon-core';

// Use a unique engine ID per test run to avoid cross-test pollution
const TEST_ENGINE = `test-engine-${Date.now()}`;
let testHome = '';

describe('session-store v2: disk-backed tool cache', () => {
  beforeEach(() => {
    testHome = setupTestAgonHome('session-store-cache');
  });

  afterEach(() => {
    // Clean up test session data
    try { clearSessionState(TEST_ENGINE); } catch { /* may not exist */ }
    try { clearConversation(); } catch { /* may not exist */ }
    cleanupTestAgonHome(testHome);
  });

  it('saveToolResultToDisk writes file and returns manifest entry', () => {
    const content = 'This is a large tool result that exceeds the inline limit.\n'.repeat(50);
    const entry = saveToolResultToDisk(TEST_ENGINE, 'call_123', 'Read', content);

    expect(entry).not.toBeNull();
    expect(entry!.toolCallId).toBe('call_123');
    expect(entry!.toolName).toBe('Read');
    expect(entry!.byteSize).toBeGreaterThan(0);
    expect(existsSync(entry!.filePath)).toBe(true);
  });

  it('loadToolResultFromDisk retrieves saved content', () => {
    const content = 'Full tool result content here';
    saveToolResultToDisk(TEST_ENGINE, 'call_456', 'Grep', content);

    const loaded = loadToolResultFromDisk(TEST_ENGINE, 'call_456');
    expect(loaded).toBe(content);
  });

  it('loadToolResultFromDisk returns null for missing ID', () => {
    const loaded = loadToolResultFromDisk(TEST_ENGINE, 'nonexistent_id');
    expect(loaded).toBeNull();
  });

  it('pruneToolCache removes files not in keep set', () => {
    saveToolResultToDisk(TEST_ENGINE, 'keep_this', 'Read', 'content 1');
    saveToolResultToDisk(TEST_ENGINE, 'remove_this', 'Read', 'content 2');

    const keepIds = new Set(['keep_this']);
    pruneToolCache(TEST_ENGINE, keepIds);

    expect(loadToolResultFromDisk(TEST_ENGINE, 'keep_this')).toBe('content 1');
    expect(loadToolResultFromDisk(TEST_ENGINE, 'remove_this')).toBeNull();
  });

  it('pruneToolCache handles empty keep set', () => {
    saveToolResultToDisk(TEST_ENGINE, 'a', 'Read', 'x');
    saveToolResultToDisk(TEST_ENGINE, 'b', 'Read', 'y');

    pruneToolCache(TEST_ENGINE, new Set());

    expect(loadToolResultFromDisk(TEST_ENGINE, 'a')).toBeNull();
    expect(loadToolResultFromDisk(TEST_ENGINE, 'b')).toBeNull();
  });
});

describe('session-store v2: state persistence', () => {
  const ENGINE_ID = `persist-test-${Date.now()}`;

  beforeEach(() => {
    testHome = setupTestAgonHome('session-store-state');
  });

  afterEach(() => {
    try { clearSessionState(ENGINE_ID); } catch { /* clean */ }
    try { clearConversation(); } catch { /* clean */ }
    cleanupTestAgonHome(testHome);
  });

  it('saves and loads session state with v2 schema', () => {
    const history = [
      { role: 'system', content: 'You are helpful' },
      { role: 'user', content: 'Hello' },
      { role: 'assistant', content: 'Hi there!' },
    ];
    const compaction = {
      kind: 'compaction' as const,
      goal: 'Test goal',
      discoveries: ['found a bug'],
      filesModified: ['src/foo.ts'],
      filesRead: ['src/foo.ts', 'src/bar.ts'],
      toolsSummary: ['Read(src/foo.ts)'],
      decisions: ['use approach A'],
      progress: 'halfway done',
      compactedAt: Date.now(),
      messagesCompacted: 10,
    };
    const manifest = [
      { toolCallId: 'call_1', toolName: 'Read', filePath: '/tmp/cache/call_1.txt', savedAt: Date.now(), byteSize: 100 },
    ];

    saveSessionState(ENGINE_ID, {
      messageHistory: history,
      confidence: 0.85,
      compactionSummary: compaction,
      toolCacheManifest: manifest,
    });

    const loaded = loadSessionState(ENGINE_ID);
    expect(loaded).not.toBeNull();
    expect(loaded!.messageHistory).toHaveLength(3);
    expect(loaded!.confidence).toBe(0.85);
    expect(loaded!.compactionSummary).not.toBeNull();
    expect(loaded!.compactionSummary!.goal).toBe('Test goal');
    expect(loaded!.compactionSummary!.discoveries).toContain('found a bug');
    expect(loaded!.toolCacheManifest).toHaveLength(1);
    expect(loaded!.toolCacheManifest[0].toolCallId).toBe('call_1');
  });

  it('loads state without compactionSummary (backward compat)', () => {
    // Save minimal state — no compactionSummary or toolCacheManifest
    saveSessionState(ENGINE_ID, { messageHistory: [{ role: 'user', content: 'hi' }], confidence: null });

    const loaded = loadSessionState(ENGINE_ID);
    expect(loaded).not.toBeNull();
    // Should default missing fields to null/empty
    expect(loaded!.compactionSummary).toBeNull();
    expect(loaded!.toolCacheManifest).toEqual([]);
    expect(loaded!.messageHistory).toHaveLength(1);
  });

  it('trims to 80 messages', () => {
    const history = Array.from({ length: 100 }, (_, i) => ({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `message ${i}`,
    }));

    saveSessionState(ENGINE_ID, { messageHistory: history, confidence: null });
    const loaded = loadSessionState(ENGINE_ID);
    expect(loaded).not.toBeNull();
    expect(loaded!.messageHistory.length).toBeLessThanOrEqual(80);
    // Should keep the LAST 80 messages
    expect(loaded!.messageHistory[loaded!.messageHistory.length - 1].content).toBe('message 99');
  });

  it('clearSessionState removes state file', () => {
    saveSessionState(ENGINE_ID, {
      messageHistory: [{ role: 'user', content: 'test' }],
      confidence: null,
    });
    expect(loadSessionState(ENGINE_ID)).not.toBeNull();

    clearSessionState(ENGINE_ID);
    expect(loadSessionState(ENGINE_ID)).toBeNull();
  });
});

describe('session-store v2.1: conversation continuity store', () => {
  beforeEach(() => {
    testHome = setupTestAgonHome('conversation-store');
  });

  afterEach(() => {
    try { clearConversation(); } catch { /* clean */ }
    cleanupTestAgonHome(testHome);
  });

  it('strips engine-specific tool artifacts during handoff', () => {
    const stripped = stripEngineArtifacts([
      {
        role: 'assistant',
        content: null,
        tool_calls: [{ id: 'call_1', function: { name: 'Read', arguments: '{"path":"src/app.ts"}' } }],
      },
      {
        role: 'tool',
        content: { ok: true, lines: 42 },
        tool_call_id: 'call_1',
      },
    ]);

    expect(stripped).toEqual([
      { role: 'assistant', content: '[Tool calls omitted during engine handoff: Read]' },
      { role: 'user', content: `[Tool result from previous Read call]\n${JSON.stringify({ ok: true, lines: 42 })}` },
    ]);
  });

  it('sanitizes legacy conversation stores with orphan tool messages on load', () => {
    const cwdHash = createHash('md5').update(process.cwd()).digest('hex').slice(0, 8);
    const sessionsDir = join(testHome, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, `conversation-${cwdHash}.json`), JSON.stringify({
      schemaVersion: 1,
      savedAt: Date.now(),
      sourceEngine: 'kimi',
      messageHistory: [
        { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', function: { name: 'Read', arguments: '{}' } }] },
        { role: 'tool', content: 'file contents', tool_call_id: 'call_1' },
      ],
    }), 'utf-8');

    const loaded = loadConversation();
    expect(loaded!.messageHistory).toEqual([
      { role: 'assistant', content: '[Tool calls omitted during engine handoff: Read]' },
      { role: 'user', content: '[Tool result from previous Read call]\nfile contents' },
    ]);
  });

  it('saves and loads the latest workspace conversation with timestamp metadata', () => {
    saveConversation([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ], 'claude');

    const loaded = loadConversation();
    expect(loaded).not.toBeNull();
    expect(loaded!.sourceEngine).toBe('claude');
    expect(loaded!.savedAt).toBeGreaterThan(0);
    expect(loaded!.messageHistory).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi' },
    ]);
  });

  // ── codex FIX 1: cross-engine readPaths handoff round-trip ──
  it('round-trips readPaths so a cross-engine handoff carries the source registry', () => {
    // The SOURCE engine's serialized ReadPathRegistry must survive save→load so
    // the next engine can restore grounded reads directly. stripEngineArtifacts
    // flattens tool_calls to text, so the readPaths field is the ONLY reliable
    // channel — derivation from the replayed history is impossible.
    const readPaths = ['/repo/package.json', '/repo/src/app.ts'];
    saveConversation(
      [
        { role: 'user', content: 'read the manifest' },
        { role: 'assistant', content: null, tool_calls: [{ id: 'c1', function: { name: 'Read', arguments: '{}' } }] },
        { role: 'tool', content: 'contents', tool_call_id: 'c1' },
      ],
      'kimi',
      readPaths,
    );

    const loaded = loadConversation();
    expect(loaded).not.toBeNull();
    expect(loaded!.readPaths).toEqual(readPaths);
    // The history was still stripped (tool_calls → text marker), proving readPaths
    // is the only surviving source of the read set.
    expect(loaded!.messageHistory.some((m: any) => Array.isArray(m.tool_calls))).toBe(false);
  });

  it('defaults readPaths to [] for an old conversation file written without the field', () => {
    // Backward-compatible: a v1/pre-FIX-1 conversation file (no readPaths key)
    // loads fine, with readPaths normalized to [].
    const cwdHash = createHash('md5').update(process.cwd()).digest('hex').slice(0, 8);
    const sessionsDir = join(testHome, 'sessions');
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(join(sessionsDir, `conversation-${cwdHash}.json`), JSON.stringify({
      schemaVersion: 1,
      savedAt: Date.now(),
      sourceEngine: 'codex',
      messageHistory: [{ role: 'user', content: 'hi' }],
    }), 'utf-8');

    const loaded = loadConversation();
    expect(loaded).not.toBeNull();
    expect(loaded!.readPaths).toEqual([]);
  });

  it('omits the readPaths key entirely when the source ran strict (undefined)', () => {
    // A strict-source save passes readPaths === undefined; JSON.stringify drops
    // an undefined field, so the on-disk JSON has NO readPaths key — byte-identical
    // to the pre-FIX-1 conversation shape.
    saveConversation(
      [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'hi' }],
      'claude',
      // readPaths intentionally omitted (undefined) — strict source.
    );
    const cwdHash = createHash('md5').update(process.cwd()).digest('hex').slice(0, 8);
    const raw = readFileSync(join(testHome, 'sessions', `conversation-${cwdHash}.json`), 'utf-8');
    const parsed = JSON.parse(raw);
    expect('readPaths' in parsed).toBe(false);
    // And it still loads, normalizing to [].
    const loaded = loadConversation();
    expect(loaded!.readPaths).toEqual([]);
  });
});
