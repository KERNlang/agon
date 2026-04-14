import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { startChatSession, appendMessage, loadChatSession, resumeChatSession, listChatSessions } from '@agon/core';
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
});
