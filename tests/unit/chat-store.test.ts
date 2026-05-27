import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startChatSession, appendMessage, loadChatSession, resumeChatSession, listChatSessions, updateChatSummary, formatChatHistoryForPrompt, formatChatContextForPrompt, buildHistoryPrimedPrompt } from '@agon/core';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

describe('chat-store', () => {
  let testHome = '';

  beforeEach(() => {
    testHome = setupTestAgonHome('chat-store');
  });

  afterEach(() => {
    cleanupTestAgonHome(testHome);
  });

  it('starts a session and returns valid ChatSession', () => {
    const session = startChatSession();
    expect(session.id).toMatch(/^chat-\d+$/);
    expect(session.startedAt).toBeTruthy();
    expect(session.messages).toEqual([]);
  });

  it('starts a session with workspace metadata', () => {
    const session = startChatSession({ cwd: '/test/path', branch: 'main', engineIds: ['claude', 'codex'] });
    expect(session.cwd).toBe('/test/path');
    expect(session.branch).toBe('main');
    expect(session.engineIds).toEqual(['claude', 'codex']);
  });

  it('appends messages to session', () => {
    const session = startChatSession();
    appendMessage(session, { role: 'user', content: 'Hello', timestamp: new Date().toISOString() });
    appendMessage(session, { role: 'engine', engineId: 'claude', content: 'Hi there', timestamp: new Date().toISOString() });
    expect(session.messages).toHaveLength(2);
    expect(session.messages[0].content).toBe('Hello');
    expect(session.messages[1].engineId).toBe('claude');
  });

  it('loads a session preserving messages and metadata', () => {
    const session = startChatSession({ cwd: '/my/project', branch: 'dev' });
    appendMessage(session, { role: 'user', content: 'Test message', timestamp: new Date().toISOString() });

    const loaded = loadChatSession(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(session.id);
    expect(loaded!.messages).toHaveLength(1);
    expect(loaded!.messages[0].content).toBe('Test message');
    expect(loaded!.cwd).toBe('/my/project');
    expect(loaded!.branch).toBe('dev');
  });

  it('resumes an existing session', () => {
    const session = startChatSession();
    appendMessage(session, { role: 'user', content: 'First', timestamp: new Date().toISOString() });

    const resumed = resumeChatSession(session.id);
    expect(resumed).not.toBeNull();
    expect(resumed!.id).toBe(session.id);
    expect(resumed!.messages).toHaveLength(1);
  });

  it('returns null when resuming non-existent session', () => {
    const result = resumeChatSession('chat-nonexistent-999');
    expect(result).toBeNull();
  });

  it('lists sessions and includes both', () => {
    const s1 = startChatSession();
    appendMessage(s1, { role: 'user', content: 'Session 1', timestamp: new Date().toISOString() });

    const s2 = startChatSession();
    appendMessage(s2, { role: 'user', content: 'Session 2', timestamp: new Date().toISOString() });

    const list = listChatSessions(10);
    const ids = list.map((s: any) => s.id);
    expect(ids).toContain(s1.id);
    expect(ids).toContain(s2.id);
  });

  it('backward compat: loads old sessions without metadata fields', () => {
    // A session started without opts should load fine
    const session = startChatSession();
    const loaded = loadChatSession(session.id);
    expect(loaded).not.toBeNull();
    // Metadata fields should be undefined
    expect(loaded!.cwd).toBeUndefined();
    expect(loaded!.branch).toBeUndefined();
    expect(loaded!.engineIds).toBeUndefined();
  });

  it('formats prompt history with message and total caps', () => {
    const session = startChatSession();
    appendMessage(session, { role: 'user', content: 'short', timestamp: new Date().toISOString() });
    appendMessage(session, { role: 'engine', engineId: 'claude', content: 'x'.repeat(500), timestamp: new Date().toISOString() });

    const formatted = formatChatHistoryForPrompt(session.messages, {
      maxMessages: 2,
      maxChars: 220,
      maxMessageChars: 120,
    });

    expect(formatted).toContain('User: short');
    expect(formatted).toContain('claude:');
    expect(formatted.length).toBeLessThanOrEqual(220);
    expect(formatted).toContain('chars omitted');
  });

  it('buildHistoryPrimedPrompt does not replay oversized history in full', () => {
    const session = startChatSession();
    appendMessage(session, { role: 'engine', engineId: 'codex', content: 'large\n'.repeat(2000), timestamp: new Date().toISOString() });

    const prompt = buildHistoryPrimedPrompt(session, 'current task');

    expect(prompt).toContain('[Prior conversation]');
    expect(prompt).toContain('[Current turn]');
    expect(prompt).toContain('current task');
    expect(prompt.length).toBeLessThan(14_000);
    expect(prompt).toContain('chars omitted');
  });

  it('keeps a rolling summary of older current-session messages', () => {
    const session = startChatSession();
    for (let i = 0; i < 20; i++) {
      appendMessage(session, { role: i % 2 === 0 ? 'user' : 'engine', engineId: i % 2 === 0 ? undefined : 'codex', content: `message-${i} ` + 'detail '.repeat(20), timestamp: new Date().toISOString() });
    }

    expect(session.summary).toContain('message-0');
    expect(session.summary).toContain('message-7');
    expect(session.summarizedMessageCount).toBeGreaterThan(0);

    const context = formatChatContextForPrompt(session, {
      maxMessages: 4,
      maxChars: 1000,
      maxMessageChars: 120,
      maxSummaryChars: 1000,
    });
    expect(context).toContain('[Earlier conversation summary]');
    expect(context).toContain('[Recent conversation]');
    expect(context).toContain('message-0');
    expect(context).toContain('message-19');
  });

  it('frees in-memory bodies of summarized messages so a long session stays bounded', () => {
    const session = startChatSession();
    for (let i = 0; i < 40; i++) {
      appendMessage(session, { role: 'engine', engineId: 'codex', content: `BODY-${i}-` + 'x'.repeat(2000), timestamp: new Date().toISOString() });
    }
    const tail = 12; // CHAT_SUMMARY_TAIL_MESSAGES
    const older = session.messages.slice(0, session.messages.length - tail);
    const recent = session.messages.slice(-tail);
    // Older turns are folded into the summary and their heavy bodies freed…
    expect(older.length).toBeGreaterThan(0);
    expect(older.every((m: any) => m.content === '')).toBe(true);
    // …while the recent tail keeps full content for live context.
    expect(recent.some((m: any) => (m.content?.length ?? 0) > 1000)).toBe(true);
    // Total in-memory content is bounded by the tail, not the whole session.
    const totalChars = session.messages.reduce((n: number, m: any) => n + (m.content?.length ?? 0), 0);
    expect(totalChars).toBeLessThan(tail * 2100 + 200);
    // Nothing is lost: the freed turns are captured in the summary (and on disk).
    expect(session.summary).toContain('BODY-0');
  });

  it('persists rolling summary records for resumed chats', () => {
    const session = startChatSession();
    for (let i = 0; i < 18; i++) {
      appendMessage(session, { role: 'user', content: `persisted-${i}`, timestamp: new Date().toISOString() });
    }
    updateChatSummary(session);

    const loaded = loadChatSession(session.id);

    expect(loaded?.summary).toBe(session.summary);
    expect(loaded?.summarizedMessageCount).toBe(session.summarizedMessageCount);
    expect(formatChatContextForPrompt(loaded, { maxMessages: 3 })).toContain('persisted-0');
  });

  it('frees already-summarized bodies on resume so a long --continue does not restore the RAM footprint', () => {
    const session = startChatSession();
    for (let i = 0; i < 40; i++) {
      appendMessage(session, { role: 'engine', engineId: 'codex', content: `RESUME-${i}-` + 'y'.repeat(2000), timestamp: new Date().toISOString() });
    }
    const loaded = loadChatSession(session.id);
    expect(loaded).not.toBeNull();
    const count = loaded!.summarizedMessageCount ?? 0;
    expect(count).toBeGreaterThan(0);
    // The summarized prefix is reloaded as empty bodies (covered by the summary + disk)…
    expect(loaded!.messages.slice(0, count).every((m: any) => m.content === '')).toBe(true);
    // …the tail keeps full content, and old turns are still recoverable via the summary.
    expect(loaded!.messages.slice(count).some((m: any) => (m.content?.length ?? 0) > 1000)).toBe(true);
    expect(loaded!.summary).toContain('RESUME-0');
  });
});
