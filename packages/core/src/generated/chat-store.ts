import { mkdirSync, appendFileSync, readFileSync, readdirSync, statSync } from 'node:fs';

import { join } from 'node:path';

import { AGON_HOME } from './config.js';

export interface ChatMessage {
  role: 'user'|'engine';
  engineId?: string;
  content: string;
  timestamp: string;
}

export interface ChatSession {
  id: string;
  startedAt: string;
  messages: ChatMessage[];
}

export function chatsDir(): string {
  return join(AGON_HOME, 'chats');
  
}

export function ensureChatsDir(): void {
  mkdirSync(chatsDir(), { recursive: true });
  
}

export function startChatSession(): ChatSession {
  ensureChatsDir();
  const id = `chat-${Date.now()}`;
  const session: ChatSession = { id, startedAt: new Date().toISOString(), messages: [] };
  const filePath = join(chatsDir(), `${id}.ndjson`);
  appendFileSync(filePath, JSON.stringify({ _type: 'header', id, startedAt: session.startedAt }) + '\n');
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
  
    return { id: header.id ?? id, startedAt: header.startedAt ?? '', messages };
  } catch {
    return null;
  }
  
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
  } catch {
    return [];
  }
  
}

export function latestChatSession(): ChatSession|null {
  const sessions = listChatSessions(1);
  return sessions.length > 0 ? sessions[0] : null;
  
}

