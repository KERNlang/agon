// @kern-source: paste-store:1
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';

// @kern-source: paste-store:2
import { join } from 'node:path';

// @kern-source: paste-store:3
import { createHash } from 'node:crypto';

// @kern-source: paste-store:4
import { AGON_HOME, ensureAgonHome } from './config.js';

// @kern-source: paste-store:6
export const PASTE_STORE_DIR: string = join(AGON_HOME, 'paste-cache');

// @kern-source: paste-store:11
export const PASTE_MAX_AGE: number = 7 * 24 * 60 * 60 * 1000;

// @kern-source: paste-store:15
export interface PasteStoreResult {
  hash: string;
  preview: string;
  lineCount: number;
}

// @kern-source: paste-store:20
function ensurePasteDir(): void {
  ensureAgonHome();
  mkdirSync(PASTE_STORE_DIR, { recursive: true });
}

// @kern-source: paste-store:26
export class PasteStore {

  store(text: string): PasteStoreResult {
    ensurePasteDir();
    const hash = createHash('sha256').update(text).digest('hex');
    const filePath = join(PASTE_STORE_DIR, `${hash}.txt`);
    if (!existsSync(filePath)) {
      writeFileSync(filePath, text);
    }
    const lines = text.split('\n');
    const preview = text.slice(0, 200).replace(/\n/g, ' ').trim();
    return { hash, preview, lineCount: lines.length };
  }

  retrieve(hash: string): string|null {
    const filePath = join(PASTE_STORE_DIR, `${hash}.txt`);
    if (!existsSync(filePath)) return null;
    return readFileSync(filePath, 'utf-8');
  }

  cleanup(maxAge?: number): number {
    const age = maxAge ?? PASTE_MAX_AGE;
    const now = Date.now();
    let deleted = 0;
    ensurePasteDir();
    try {
      const files = readdirSync(PASTE_STORE_DIR).filter((f: string) => f.endsWith('.txt'));
      for (const f of files) {
        const fp = join(PASTE_STORE_DIR, f);
        try {
          const stat = statSync(fp);
          if (now - stat.mtimeMs > age) {
            unlinkSync(fp);
            deleted++;
          }
        } catch (_e) { console.warn(`[agon] paste-store: cleanup failed for ${fp}: ${_e instanceof Error ? _e.message : String(_e)}`); }
      }
    } catch (err) { console.warn(`[agon] paste cleanup failed: ${err instanceof Error ? err.message : String(err)}`); }
    return deleted;
  }
}

