// RED test for Cesar gap #1 (memory): a fresh `agon` process starts blind.
//
// The chat path builds its prompt from `formatChatContextForPrompt(ctx.chatSession)`,
// and `ctx.chatSession` is initialised empty via `startChatSession(...)` on every new
// process (surfaces/app.kern). The durable ContextThread IS written after each turn
// (handlers/chat.kern, gated on config.sessionContinuity) but is NEVER read back, so a
// new process cannot see prior turns unless the user manually `/chats resume`s.
//
// This test pins the missing read-back seam: `seedChatSessionFromThread(session, thread)`
// should hydrate an empty session from the durable thread so the existing prompt
// formatter (and the UI transcript) carry the prior conversation. It is RED until that
// function exists and is wired.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  ContextThread,
  loadOrCreateActiveThread,
  deleteThread,
  startChatSession,
  loadChatSession,
  formatChatContextForPrompt,
  seedChatSessionFromThread,
} from '@kernlang/agon-core';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

const cleanupIds: Array<{ projectPath: string; threadId: string }> = [];
let testHome = '';

function makeProject(label: string): string {
  return join(tmpdir(), `agon-rehydrate-${label}-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

beforeEach(() => {
  testHome = setupTestAgonHome('chat-session-rehydrate');
});

afterEach(() => {
  for (const { projectPath, threadId } of cleanupIds) {
    try { deleteThread(projectPath, threadId); } catch { /* ignore */ }
  }
  cleanupIds.splice(0);
  cleanupTestAgonHome(testHome);
});

async function persistThreadWithTurns(projectPath: string): Promise<ContextThread> {
  const thread = loadOrCreateActiveThread(projectPath);
  cleanupIds.push({ projectPath: thread.getProjectPath(), threadId: thread.getThreadId() });
  thread.append({ role: 'user', content: 'remember the secret token is HORIZON-42' });
  thread.append({ role: 'assistant', content: 'Noted — the token is HORIZON-42.', engineId: 'codex' });
  await thread.save();
  return thread;
}

describe('seedChatSessionFromThread — cross-process memory rehydration', () => {
  it('hydrates an empty fresh session from the durable thread', () => {
    const projectPath = makeProject('hydrate');
    return persistThreadWithTurns(projectPath).then((thread) => {
      // Simulate a brand-new process: a fresh, empty in-memory session.
      const session = startChatSession({ cwd: projectPath });
      expect(session.messages.length).toBe(0);

      seedChatSessionFromThread(session, thread);

      // Prior turns must now be present, with thread roles mapped to chat roles
      // (thread 'user' -> chat 'user', thread 'assistant' -> chat 'engine').
      expect(session.messages.length).toBeGreaterThanOrEqual(2);
      const contents = session.messages.map((m) => m.content).join('\n');
      expect(contents).toContain('HORIZON-42');
      const roles = session.messages.map((m) => m.role);
      expect(roles).toContain('user');
      expect(roles).toContain('engine');
    });
  });

  it('makes prior turns visible in the assembled chat prompt', () => {
    const projectPath = makeProject('prompt');
    return persistThreadWithTurns(projectPath).then((thread) => {
      const session = startChatSession({ cwd: projectPath });

      // Before rehydration the prompt is blind — this is the current (buggy) behavior.
      expect(formatChatContextForPrompt(session)).not.toContain('HORIZON-42');

      seedChatSessionFromThread(session, thread);

      // After rehydration the existing formatter carries the prior conversation.
      expect(formatChatContextForPrompt(session)).toContain('HORIZON-42');
    });
  });

  it('persists seeded turns to the session ndjson so /chats resume stays consistent', () => {
    const projectPath = makeProject('persist');
    return persistThreadWithTurns(projectPath).then((thread) => {
      const session = startChatSession({ cwd: projectPath });
      seedChatSessionFromThread(session, thread);

      // The on-disk session log must match what is in memory — not just the new turns.
      const reloaded = loadChatSession(session.id);
      expect(reloaded).not.toBeNull();
      const messages = reloaded?.messages ?? [];
      expect(messages.length).toBeGreaterThanOrEqual(2);
      expect(messages.map((m) => m.content).join('\n')).toContain('HORIZON-42');
    });
  });
});
