import { mkdirSync, appendFileSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';

import { join } from 'node:path';

import { AGON_HOME } from './config.js';

export interface ChatMessage {
  role: 'user'|'engine';
  engineId?: string;
  content: string;
  timestamp: string;
  images?: string[];
}

export interface ChatSession {
  id: string;
  startedAt: string;
  messages: ChatMessage[];
  cwd?: string;
  branch?: string;
  engineIds?: string[];
}

export function chatsDir(): string {
  return join(AGON_HOME, 'chats');
}

export function ensureChatsDir(): void {
  mkdirSync(chatsDir(), { recursive: true });
}

export function startChatSession(opts?: {cwd?:string,branch?:string,engineIds?:string[]}): ChatSession {
  ensureChatsDir();
  const id = `chat-${Date.now()}`;
  const session: ChatSession = {
    id,
    startedAt: new Date().toISOString(),
    messages: [],
    cwd: opts?.cwd,
    branch: opts?.branch,
    engineIds: opts?.engineIds,
  };
  const filePath = join(chatsDir(), `${id}.ndjson`);
  const header: Record<string, unknown> = {
    _type: 'header',
    id,
    startedAt: session.startedAt,
  };
  if (opts?.cwd) header.cwd = opts.cwd;
  if (opts?.branch) header.branch = opts.branch;
  if (opts?.engineIds) header.engineIds = opts.engineIds;
  appendFileSync(filePath, JSON.stringify(header) + '\n');
  return session;
}

export function appendMessage(session: ChatSession, msg: ChatMessage): void {
  session.messages.push(msg);
  const filePath = join(chatsDir(), `${session.id}.ndjson`);
  appendFileSync(filePath, JSON.stringify(msg) + '\n');
}

export function loadChatSession(id: string): ChatSession|null {
  try {
    const filePath = join(chatsDir(), `${id}.ndjson`);
    const raw = readFileSync(filePath, 'utf-8');
    const lines = raw.trim().split('\n').filter(Boolean);
    if (lines.length === 0) return null;
  
    const header = JSON.parse(lines[0]);
    const messages: ChatMessage[] = [];
    for (let i = 1; i < lines.length; i++) {
      const msg = JSON.parse(lines[i]);
      if (msg.role) messages.push(msg);
    }
  
    return {
      id: header.id ?? id,
      startedAt: header.startedAt ?? '',
      messages,
      cwd: header.cwd,
      branch: header.branch,
      engineIds: header.engineIds,
    };
  } catch (err) {
    console.warn(`[agon] failed to load chat session ${id}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export function resumeChatSession(id: string): ChatSession|null {
  return loadChatSession(id);
}

export function listChatSessions(limit: number): ChatSession[] {
  ensureChatsDir();
  try {
    const dir = chatsDir();
    const files = readdirSync(dir)
      .filter((f: string) => f.endsWith('.ndjson'))
      .map((f: string) => ({
        name: f,
        mtime: statSync(join(dir, f)).mtimeMs,
      }))
      .sort((a: {mtime:number}, b: {mtime:number}) => b.mtime - a.mtime)
      .slice(0, limit);
  
    return files.map((f: {name:string}) => {
      const id = f.name.replace('.ndjson', '');
      return loadChatSession(id);
    }).filter((s: ChatSession|null): s is ChatSession => s !== null);
  } catch (err) {
    console.warn(`[agon] failed to list chat sessions: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

export function latestChatSession(): ChatSession|null {
  const sessions = listChatSessions(1);
  return sessions.length > 0 ? sessions[0] : null;
}

