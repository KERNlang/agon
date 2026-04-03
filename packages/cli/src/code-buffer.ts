// ── Code Block Buffer — KERN-sourced, singleton facade ───────────────
// Source of truth: kern/code-buffer.kern → generated/code-buffer.ts
import { CodeBlockBuffer } from './generated/code-buffer.js';
export type { CodeBlock } from './generated/code-buffer.js';
export { CodeBlockBuffer };

export const codeBlockBuffer = new CodeBlockBuffer();
