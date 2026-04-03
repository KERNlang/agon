import { pasteStore, PASTE_THRESHOLD } from '@agon/core';

import type { PasteStoreResult } from '@agon/core';

export type PasteResult =
  | { type: 'stored'; tag: string; fullHash: string; placeholder: string }
  | { type: 'direct'; content: string }
  | { type: 'empty' };

export function processPasteContent(raw: string): PasteResult {
  const content = raw.replace(/\r\n/g, '\n').trimEnd();
  if (!content) return { type: 'empty' };
  
  if (content.length > PASTE_THRESHOLD) {
    try {
      const result = pasteStore.store(content);
      const tag = result.hash.slice(0, 8);
      const placeholder = `[Paste:${tag} ${result.lineCount} lines]`;
      return { type: 'stored', tag, fullHash: result.hash, placeholder };
    } catch {
      // Storage failed — fall through to direct
    }
  }
  
  return { type: 'direct', content };
}

export function expandPastePlaceholders(input: string, hashMap: Map<string,string>): string {
  const pasteRe = /\[Paste:([a-f0-9]{8}) \d+ lines\]/g;
  const expanded = input.replace(pasteRe, (_match: string, tag: string) => {
    const fullHash = hashMap.get(tag);
    if (!fullHash) return _match;
    const content = pasteStore.retrieve(fullHash);
    return content ?? _match;
  });
  // Clean up used tags after all replacements are done
  for (const tag of [...hashMap.keys()]) {
    if (!expanded.includes(`[Paste:${tag}`)) hashMap.delete(tag);
  }
  return expanded;
}

