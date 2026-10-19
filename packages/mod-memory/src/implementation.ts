import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type { AgonModFactory, InvocationContext, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { appendMemoryLine, canonicalMemorySection, MEMORY_FILE_REL, MEMORY_SECTIONS, todayPrefix } from '@kernlang/agon-support-persistence';

const schema = Object.freeze({
  type: 'object',
  required: ['memory', 'section'],
  properties: {
    memory: { type: 'string', minLength: 1, description: 'One durable project fact. The date is added automatically.' },
    section: { type: 'string', enum: MEMORY_SECTIONS },
  },
}) as Readonly<Record<string, Json>>;

export async function saveMemory(raw: Json, context: InvocationContext, services: ModServices): Promise<Json> {
  const input = raw as Record<string, Json>;
  if (typeof input.memory !== 'string' || !input.memory.trim()) throw new TypeError('Missing required parameter: memory');
  const section = canonicalMemorySection(input.section);
  if (!section) throw new TypeError('Invalid project-memory section');
  context.signal.throwIfAborted();
  const path = resolve(context.cwd, MEMORY_FILE_REL);
  if (await services.permissions.check('fs.write', path) !== 'allow') throw new Error('Permission denied: fs.write is required');
  context.signal.throwIfAborted();
  context.assertCurrent?.();
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : '';
  const result = appendMemoryLine(existing, section, input.memory, todayPrefix());
  if (!result.changed) return 'Already in project memory [' + section + '] — skipped (near-duplicate).';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, result.content.endsWith('\n') ? result.content : result.content + '\n', 'utf8');
  try { await context.didWriteFile?.(path, result.content); }
  catch { /* Cache refresh is best effort, as in the legacy tool. */ }
  const note = result.status === 'evicted' ? ' (section was full — oldest entry dropped)' : '';
  return 'Saved to project memory [' + section + ']: ' + input.memory + note;
}

export const createMod: AgonModFactory = services => Object.freeze({
  apiVersion: '1' as const,
  async activate(registrar: Registrar) {
    const disposers = (['mcp', 'cesar'] as const).map(surface => registrar.tool(surface, {
      id: surface === 'mcp' ? 'mcpTools:0030' : 'cesarTools:0024',
      description: 'Save one durable project fact to .agon/project.md under Decisions, Constraints, Conventions or Session Notes. Each call requires confirmation; dated duplicates are skipped.',
      inputSchema: schema,
      effect: 'write',
      requiresConfirmation: true,
      run: (input, context) => saveMemory(input, context, services),
    }));
    return async () => { for (const dispose of disposers.reverse()) await dispose(); };
  },
});
export default createMod;
