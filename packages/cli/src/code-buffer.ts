// Facade over ./generated/blocks/code-buffer.js — edit the source there.
import { CodeBlockBuffer } from './blocks/code-buffer.js';
export type { CodeBlock } from './blocks/code-buffer.js';
export { CodeBlockBuffer };

export const codeBlockBuffer = new CodeBlockBuffer();
