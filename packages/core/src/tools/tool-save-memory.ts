import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

import { resolve, dirname } from 'node:path';

import type { ToolResult, ToolContext, ToolHandler, ToolDefinition, PermissionDecision } from '../models/tool-types.js';

import { MEMORY_FILE_REL, MEMORY_SECTIONS, canonicalMemorySection, appendMemoryLine, todayPrefix } from '@kernlang/agon-support-persistence';
export { MEMORY_FILE_REL, MEMORY_SECTIONS, SECTION_CAP, canonicalMemorySection, normalizeMemoryLine, todayPrefix, appendMemoryLine } from '@kernlang/agon-support-persistence';
export type { MemoryAppendResult } from '@kernlang/agon-support-persistence';

/**
 * Factory for the SaveMemory tool — records one durable cross-session fact into .agon/project.md under a section, dated and deduped. Returns 'ask' so each memory is user-confirmed.
 */
export function createSaveMemoryTool(): ToolHandler {
  const definition: ToolDefinition = {
    name: 'SaveMemory',
    description: 'Save ONE durable, cross-session fact to project memory (.agon/project.md). Use ONLY for facts that should survive into FUTURE sessions: decisions ("we chose session tokens over JWT"), constraints ("Node 20 floor", "no top-level await"), or conventions ("commits use conventional format"). NEVER for transient/session state, TODOs, or things already obvious from the code. Each call appends one dated one-liner under the chosen section; near-duplicates are skipped. The user confirms every memory.',
    inputSchema: {
      type: 'object',
      properties: {
        memory: { type: 'string', description: 'The single durable fact, as one concise sentence. Do NOT add a date — it is prefixed automatically.' },
        section: { type: 'string', description: 'Which section to file it under.', enum: ['Decisions', 'Constraints', 'Conventions', 'Session Notes'] },
      },
      required: ['memory', 'section'],
    },
    maxResultSizeChars: 4000,
    isReadOnly: false,
    isConcurrencySafe: false,
  };

  const validate = (input: Record<string, unknown>, _ctx: ToolContext): string | null => {
    if (!input.memory || typeof input.memory !== 'string' || !input.memory.trim()) {
      return 'Missing required parameter: memory (the durable fact to remember, as one sentence)';
    }
    if (!input.section || typeof input.section !== 'string') {
      return `Missing required parameter: section (one of: ${MEMORY_SECTIONS.join(', ')})`;
    }
    if (!canonicalMemorySection(input.section)) {
      return `Invalid section "${input.section}". Use one of: ${MEMORY_SECTIONS.join(', ')}`;
    }
    return null;
  };

  // Write tools auto-allow in-cwd; SaveMemory explicitly asks so the user
  // confirms each durable memory. The message surfaces the exact line + section.
  const checkPermission = (input: Record<string, unknown>, _ctx: ToolContext): PermissionDecision => {
    const section = canonicalMemorySection(input.section) ?? String(input.section ?? '');
    const memory = String(input.memory ?? '').replace(/\s+/g, ' ').trim();
    return {
      behavior: 'ask',
      message: `Save to project memory [${section}]: "${memory}"`,
      reason: 'save-memory',
    };
  };

  const execute = async (input: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> => {
    const section = canonicalMemorySection(input.section) as string;
    const memory = String(input.memory);
    const filePath = resolve(ctx.cwd, MEMORY_FILE_REL);

    let existing = '';
    try {
      if (existsSync(filePath)) existing = readFileSync(filePath, 'utf-8');
    } catch (err) {
      return { ok: false, content: '', error: `Cannot read project memory: ${err instanceof Error ? err.message : String(err)}` };
    }

    const result = appendMemoryLine(existing, section, memory, todayPrefix());

    if (!result.changed) {
      return { ok: true, content: `Already in project memory [${section}] — skipped (near-duplicate).`, metadata: { status: 'duplicate', section } };
    }

    try {
      const dir = dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, result.content.endsWith('\n') ? result.content : result.content + '\n', 'utf-8');
    } catch (err) {
      return { ok: false, content: '', error: `Failed to write project memory: ${err instanceof Error ? err.message : String(err)}` };
    }

    // Keep the read cache coherent so a later Write/Edit to the same file
    // doesn't trip the read-before-write staleness guard.
    try {
      const cache = ctx.readFileState;
      if (cache) {
        const { statSync } = await import('node:fs');
        cache.set(filePath, {
          content: result.content,
          timestamp: statSync(filePath).mtimeMs,
          offset: undefined,
          limit: undefined,
          isPartialView: false,
          lastTouchedBy: 'save-memory',
          lastTouchedAt: Date.now(),
        });
      }
    } catch { /* cache update is best-effort */ }

    const note = result.status === 'evicted' ? ` (section was full — oldest entry dropped)` : '';
    return {
      ok: true,
      content: `Saved to project memory [${section}]: ${memory}${note}`,
      metadata: { status: result.status, section },
    };
  };

  return { definition, validate, checkPermission, execute };
}
