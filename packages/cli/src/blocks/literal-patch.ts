import { charDisplayWidth } from '../surfaces/app-display-utils.js';
import { escapeLiteralText } from './literal-text.js';

export const PATCH_PREVIEW_LABEL = 'Patch preview · literal text · control characters escaped';

/** Patch data is not model narration or Markdown. Keep every line; escape
 * terminal controls and bidi formatting rather than executing or hiding them. */
export function literalPatchRows(content: string, width: number): string[] {
  const limit = Math.max(2, Number.isFinite(width) ? Math.floor(width) : 80);
  const rows: string[] = [];
  for (const source of content.split('\n')) {
    let row = '';
    let columns = 0;
    for (const char of source) {
      const token = escapeLiteralText(char);
      const size = Array.from(token).reduce((sum, part) => sum + charDisplayWidth(part), 0);
      // Keep escapes atomic unless the entire terminal row is narrower than
      // one escape. In that case retain every byte and respect the width.
      const parts = size > limit ? Array.from(token) : [token];
      for (const part of parts) {
        const partSize = parts.length === 1 ? size : charDisplayWidth(part);
        if (columns + partSize > limit && row) { rows.push(row); row = ''; columns = 0; }
        row += part;
        columns += partSize;
      }
    }
    rows.push(row);
  }
  return rows;
}

/** Mark every data row, including continuations, separately from host prompts. */
export function patchPreviewRows(content: string, width: number): string[] {
  return literalPatchRows(content, width - 2).map(row => `| ${row}`);
}
