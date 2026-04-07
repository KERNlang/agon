// @kern-source: session-store:5
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';

// @kern-source: session-store:6
import { join } from 'node:path';

// @kern-source: session-store:7
import { AGON_HOME } from './config.js';

// @kern-source: session-store:9
export function sessionStorePath(engineId: string): string {
  return join(AGON_HOME, 'sessions', `${engineId}.json`);
}

// @kern-source: session-store:14
export function saveSessionState(engineId: string, state: { messageHistory: Array<{role:string,content:string}>, confidence:number|null }): void {
  const dir = join(AGON_HOME, 'sessions');
  mkdirSync(dir, { recursive: true });
  const path = sessionStorePath(engineId);
  // Only keep last 50 messages to avoid unbounded growth
  const trimmed = state.messageHistory.slice(-50);
  const data = { messageHistory: trimmed, confidence: state.confidence, savedAt: Date.now() };
  writeFileSync(path, JSON.stringify(data), 'utf-8');
}

// @kern-source: session-store:26
export function loadSessionState(engineId: string): { messageHistory: Array<{role:string,content:string}>, confidence:number|null } | null {
  const path = sessionStorePath(engineId);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
    // TTL: discard state older than 30 minutes
    if (data.savedAt && Date.now() - data.savedAt > 30 * 60 * 1000) return null;
    if (!Array.isArray(data.messageHistory)) return null;
    return { messageHistory: data.messageHistory, confidence: data.confidence ?? null };
  } catch {
    return null;
  }
}

// @kern-source: session-store:43
export function clearSessionState(engineId: string): void {
  const path = sessionStorePath(engineId);
  try {
    const { unlinkSync } = require('node:fs');
    if (existsSync(path)) unlinkSync(path);
  } catch {}
}

