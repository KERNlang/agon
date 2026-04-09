// @kern-source: memory:5
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';

// @kern-source: memory:6
import { join } from 'node:path';

// @kern-source: memory:7
import { ensureAgonHome, AGON_HOME } from '../signals/config.js';

// @kern-source: memory:9
export const MAX_SESSION_ENTRIES: number = 50;

// @kern-source: memory:14
export const MAX_PERSISTENT_ENTRIES: number = 30;

// @kern-source: memory:19
export interface MemoryEntry {
  key: string;
  value: string;
  timestamp: string;
  category: 'file'|'decision'|'attempt'|'preference'|'pattern';
}

// @kern-source: memory:25
export interface CesarMemory {
  session: Map<string, MemoryEntry>;
  persistent: MemoryEntry[];
  remember: (key: string, value: string, category: MemoryEntry['category']) => void;
  recall: (key: string) => string | null;
  forget: (key: string) => void;
  savePersistent: (entry: MemoryEntry) => void;
  toPromptContext: () => string;
  load: () => void;
  save: () => void;
}

// @kern-source: memory:36
/**
 * Create a two-tier Cesar memory: session Map + persistent JSON.
 */
export function createCesarMemory(): CesarMemory {
  const session = new Map<string, MemoryEntry>();
  let persistent: MemoryEntry[] = [];
  const persistPath = join(AGON_HOME, 'cesar-memory.json');
  
  const memory: CesarMemory = {
    session,
    persistent,
  
    remember(key: string, value: string, category: MemoryEntry['category']) {
      const entry: MemoryEntry = { key, value, timestamp: new Date().toISOString(), category };
      session.set(key, entry);
      // Evict oldest if over limit
      if (session.size > MAX_SESSION_ENTRIES) {
        const oldest = [...session.entries()].sort((a, b) => a[1].timestamp.localeCompare(b[1].timestamp))[0];
        if (oldest) session.delete(oldest[0]);
      }
    },
  
    recall(key: string): string | null {
      const s = session.get(key);
      if (s) return s.value;
      const p = persistent.find(e => e.key === key);
      return p?.value ?? null;
    },
  
    forget(key: string) {
      session.delete(key);
      persistent = persistent.filter(e => e.key !== key);
    },
  
    savePersistent(entry: MemoryEntry) {
      // Upsert: replace if key exists
      const idx = persistent.findIndex(e => e.key === entry.key);
      if (idx >= 0) {
        persistent[idx] = entry;
      } else {
        persistent.push(entry);
      }
      // Evict oldest if over limit
      if (persistent.length > MAX_PERSISTENT_ENTRIES) {
        persistent.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
        persistent = persistent.slice(-MAX_PERSISTENT_ENTRIES);
      }
      memory.save();
    },
  
    toPromptContext(): string {
      const parts: string[] = [];
  
      // Session memory (recent)
      if (session.size > 0) {
        const sessionLines = [...session.values()]
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .slice(0, 15)
          .map(e => `- [${e.category}] ${e.key}: ${e.value}`);
        parts.push(`## SESSION MEMORY (this conversation)\n${sessionLines.join('\n')}`);
      }
  
      // Persistent memory
      if (persistent.length > 0) {
        const persistLines = persistent
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .slice(0, 10)
          .map(e => `- [${e.category}] ${e.key}: ${e.value}`);
        parts.push(`## PERSISTENT MEMORY (across sessions)\n${persistLines.join('\n')}`);
      }
  
      return parts.length > 0 ? parts.join('\n\n') : '';
    },
  
    load() {
      try {
        if (existsSync(persistPath)) {
          const raw = readFileSync(persistPath, 'utf-8');
          persistent = JSON.parse(raw);
        }
      } catch (e) { console.warn(`[agon] cesar-memory: failed to load persistent memory, resetting: ${e instanceof Error ? e.message : String(e)}`); persistent = []; }
    },
  
    save() {
      try {
        ensureAgonHome();
        writeFileSync(persistPath, JSON.stringify(persistent, null, 2), 'utf-8');
      } catch (e) { console.warn(`[agon] cesar-memory: failed to persist memory: ${e instanceof Error ? e.message : String(e)}`); }
    },
  };
  
  // Load persistent on creation
  memory.load();
  
  return memory;
}

