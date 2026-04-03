import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync, statSync } from 'node:fs';

import { join } from 'node:path';

import { createHash } from 'node:crypto';

import { AGON_HOME, ensureAgonHome } from '../config.js';

export const PASTE_STORE_DIR: string = join(AGON_HOME, 'paste-cache');

export const PASTE_THRESHOLD: number = 10_000;

export const PASTE_MAX_AGE: number = 7 * 24 * 60 * 60 * 1000;

export interface PasteStoreResult {
  hash: string;
  preview: string;
  lineCount: number;
}

function ensurePasteDir(): void {
  ensureAgonHome();
  mkdirSync(PASTE_STORE_DIR, { recursive: true });
}

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
        } catch {}
      }
    } catch {}
    return deleted;
  }
}

