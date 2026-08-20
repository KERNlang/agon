// Process-wide code-block buffer: the single CodeBlockBuffer instance
// every surface shares, over the implementation in ./blocks/code-buffer.ts.
import { CodeBlockBuffer } from './blocks/code-buffer.js';
export type { CodeBlock } from './blocks/code-buffer.js';
export { CodeBlockBuffer };

export const codeBlockBuffer = new CodeBlockBuffer();
