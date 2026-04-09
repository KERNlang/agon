// @kern-source: session-store:5
import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, readdirSync, statSync, rmdirSync } from 'node:fs';

// @kern-source: session-store:6
import { join, dirname } from 'node:path';

// @kern-source: session-store:7
import { createHash } from 'node:crypto';

// @kern-source: session-store:8
import { AGON_HOME } from './config.js';

// @kern-source: session-store:9
import type { CompactionSummaryPart, ToolCacheEntry } from '../models/context-parts.js';

// @kern-source: session-store:11
export const SESSION_SCHEMA_VERSION: number = 2;

// @kern-source: session-store:12
export const SESSION_MAX_MESSAGES: number = 80;

// @kern-source: session-store:13
/**
 * 60 minutes (was 30 min in v1)
 */
export const SESSION_TTL_MS: number = 3600000;

// @kern-source: session-store:15
/**
 * 10 MB max total disk cache per session
 */
export const TOOL_CACHE_MAX_BYTES: number = 10485760;

// @kern-source: session-store:18
export interface SessionStateV2 {
  schemaVersion: number;
  messageHistory: Array<{role:string,content:any,tool_calls?:any[],tool_call_id?:string}>;
  compactionSummary: CompactionSummaryPart|null;
  toolCacheManifest: ToolCacheEntry[];
  confidence: number|null;
  savedAt: number;
}

// @kern-source: session-store:26
/**
 * Session path scoped by engine + workspace to prevent context leaking across repos.
 */
export function sessionStorePath(engineId: string): string {
  const cwdHash = createHash('md5').update(process.cwd()).digest('hex').slice(0, 8);
  return join(AGON_HOME, 'sessions', `${engineId}-${cwdHash}.json`);
}

// @kern-source: session-store:33
/**
 * Directory for disk-backed tool result cache files.
 */
export function sessionCacheDir(engineId: string): string {
  const cwdHash = createHash('md5').update(process.cwd()).digest('hex').slice(0, 8);
  return join(AGON_HOME, 'sessions', `${engineId}-${cwdHash}-cache`);
}

// @kern-source: session-store:40
/**
 * Write a large tool result to disk cache. Returns manifest entry, or null if write failed.
 */
export function saveToolResultToDisk(engineId: string, toolCallId: string, toolName: string, content: string): ToolCacheEntry|null {
  try {
    const cacheDir = sessionCacheDir(engineId);
    mkdirSync(cacheDir, { recursive: true });
    const filePath = join(cacheDir, `${toolCallId}.txt`);
    writeFileSync(filePath, content, 'utf-8');
    return {
      toolCallId,
      toolName,
      filePath,
      savedAt: Date.now(),
      byteSize: Buffer.byteLength(content, 'utf-8'),
    };
  } catch (err) {
    console.warn(`[agon] session-cache: failed to write ${toolCallId}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

// @kern-source: session-store:61
/**
 * Read a cached tool result from disk. Returns null if not found.
 */
export function loadToolResultFromDisk(engineId: string, toolCallId: string): string|null {
  try {
    const cacheDir = sessionCacheDir(engineId);
    const filePath = join(cacheDir, `${toolCallId}.txt`);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  } catch {
    return null;
  }
}

// @kern-source: session-store:74
/**
 * Remove cached tool results not in the keep set. Prevents unbounded disk growth.
 */
export function pruneToolCache(engineId: string, keepIds: Set<string>): void {
  try {
    const cacheDir = sessionCacheDir(engineId);
    if (!existsSync(cacheDir)) return;
    const files = readdirSync(cacheDir);
    for (const f of files) {
      const id = f.replace('.txt', '');
      if (!keepIds.has(id)) {
        try { unlinkSync(join(cacheDir, f)); } catch { /* already removed */ }
      }
    }
  } catch { /* cache dir doesn't exist or inaccessible */ }
}

// @kern-source: session-store:90
/**
 * Persist API session state to disk (v2 schema).
 */
export function saveSessionState(engineId: string, state: { messageHistory: Array<{role:string,content:any,tool_calls?:any[],tool_call_id?:string}>, confidence:number|null, compactionSummary?:CompactionSummaryPart|null, toolCacheManifest?:ToolCacheEntry[] }): void {
  const dir = join(AGON_HOME, 'sessions');
  mkdirSync(dir, { recursive: true });
  const path = sessionStorePath(engineId);
  // Keep last SESSION_MAX_MESSAGES to avoid unbounded growth
  const trimmed = state.messageHistory.slice(-SESSION_MAX_MESSAGES);
  const data: SessionStateV2 = {
    schemaVersion: SESSION_SCHEMA_VERSION,
    messageHistory: trimmed,
    compactionSummary: state.compactionSummary ?? null,
    toolCacheManifest: state.toolCacheManifest ?? [],
    confidence: state.confidence,
    savedAt: Date.now(),
  };
  writeFileSync(path, JSON.stringify(data), 'utf-8');
}

// @kern-source: session-store:109
/**
 * Load persisted API session state from disk. Handles v1→v2 migration transparently.
 */
export function loadSessionState(engineId: string): { messageHistory: Array<{role:string,content:any,tool_calls?:any[],tool_call_id?:string}>, confidence:number|null, compactionSummary:CompactionSummaryPart|null, toolCacheManifest:ToolCacheEntry[] } | null {
  const path = sessionStorePath(engineId);
  if (!existsSync(path)) return null;
  try {
    const raw = readFileSync(path, 'utf-8');
    const data = JSON.parse(raw);
  
    // TTL: discard state older than SESSION_TTL_MS
    if (data.savedAt && Date.now() - data.savedAt > SESSION_TTL_MS) return null;
    if (!Array.isArray(data.messageHistory)) return null;
  
    // v1 migration: old format has no schemaVersion
    if (!data.schemaVersion || data.schemaVersion < 2) {
      return {
        messageHistory: data.messageHistory,
        confidence: data.confidence ?? null,
        compactionSummary: null,
        toolCacheManifest: [],
      };
    }
  
    return {
      messageHistory: data.messageHistory,
      confidence: data.confidence ?? null,
      compactionSummary: data.compactionSummary ?? null,
      toolCacheManifest: data.toolCacheManifest ?? [],
    };
  } catch {
    return null;
  }
}

// @kern-source: session-store:143
/**
 * Delete persisted session state and its cache directory.
 */
export function clearSessionState(engineId: string): void {
  const path = sessionStorePath(engineId);
  try { if (existsSync(path)) unlinkSync(path); } catch { /* already removed */ }
  // Clean up cache dir too
  try {
    const cacheDir = sessionCacheDir(engineId);
    if (existsSync(cacheDir)) {
      const files = readdirSync(cacheDir);
      for (const f of files) { try { unlinkSync(join(cacheDir, f)); } catch { /* skip */ } }
      rmdirSync(cacheDir);
    }
  } catch { /* cache dir cleanup is best-effort */ }
}

