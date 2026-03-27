// ── Markdown fence parser — KERN-sourced, type-safe facade ───────────
// Source of truth: kern/markdown.kern → generated/markdown.ts
// This file re-exports with a discriminated union type for TS consumers.

import {
  parseMarkdownBlocks as _parseMarkdownBlocks,
  truncateCodeLine,
  cleanEngineOutput,
} from './generated/markdown.js';

export type ContentSegment =
  | { type: 'prose'; text: string }
  | { type: 'code'; language: string; code: string; index: number };

export function parseMarkdownBlocks(text: string): ContentSegment[] {
  return _parseMarkdownBlocks(text) as ContentSegment[];
}

export { truncateCodeLine, cleanEngineOutput };
