import { copyToClipboard } from '@agon/core';

import { codeBlockBuffer } from '../code-buffer.js';

import type { Dispatch } from '../handlers/types.js';

export function handleCp(index: number|undefined, dispatch: Dispatch): void {
  if (index === undefined) {
    // Copy the last code block
    const blocks = codeBlockBuffer.blocks;
    if (blocks.length === 0) {
      dispatch({ type: 'warning', message: 'No code blocks to copy.' });
      return;
    }
    const last = blocks[blocks.length - 1];
    try {
      copyToClipboard(last.code);
      dispatch({ type: 'success', message: `Copied block [${last.index}] (${last.language || 'code'}) to clipboard` });
    } catch (err) {
      dispatch({ type: 'error', message: `Failed to copy: ${err instanceof Error ? err.message : String(err)}` });
    }
    return;
  }
  
  const block = codeBlockBuffer.get(index);
  if (!block) {
    dispatch({ type: 'warning', message: `No code block [${index}]. Available: 1-${codeBlockBuffer.blocks.length}` });
    return;
  }
  
  try {
    copyToClipboard(block.code);
    dispatch({ type: 'success', message: `Copied block [${block.index}] (${block.language || 'code'}) to clipboard` });
  } catch (err) {
    dispatch({ type: 'error', message: `Failed to copy: ${err instanceof Error ? err.message : String(err)}` });
  }
  
}

