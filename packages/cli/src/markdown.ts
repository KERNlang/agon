// Public markdown surface over ./blocks/markdown.ts, re-typed so block
// parsing returns a discriminated union instead of a widened record.

import {
  parseMarkdownBlocks as _parseMarkdownBlocks,
  truncateCodeLine,
  cleanEngineOutput,
} from './blocks/markdown.js';

export type ContentSegment =
  | { type: 'prose'; text: string }
  | { type: 'code'; language: string; code: string; index: number }
  | { type: 'table'; headers: string[]; rows: string[][]; alignments: ('left' | 'center' | 'right')[] };

export function parseMarkdownBlocks(text: string): ContentSegment[] {
  return _parseMarkdownBlocks(text) as ContentSegment[];
}

export { truncateCodeLine, cleanEngineOutput };
