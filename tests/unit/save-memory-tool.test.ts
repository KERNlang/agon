// Behavioral tests for the SaveMemory tool (Cesar→CC parity, Phase C).
// The .kern test pins KERN validity + structure; this pins the runtime
// behavior the in-prompt interpreter can't execute: append-with-dedup, the
// per-section cap, the dated prefix, the 'ask' confirm gate, the [PROJECT
// MEMORY] prompt block, and that a `fitness:` line in the same file survives.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createSaveMemoryTool,
  appendMemoryLine,
  normalizeMemoryLine,
  todayPrefix,
} from '../../packages/core/src/generated/tools/tool-save-memory.js';
import {
  buildProjectMemoryBlock,
  extractProjectMemorySections,
} from '../../packages/core/src/generated/cesar/memory.js';
import { parseFitnessLine } from '../../packages/core/src/generated/blocks/context-scanner.js';

const ctx = (cwd: string) => ({ cwd, readFileState: new Map() }) as never;
const D = '2026-06-11';

describe('SaveMemory — pure helpers', () => {
  it('todayPrefix is YYYY-MM-DD', () => {
    expect(todayPrefix()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('normalizeMemoryLine strips bullet, date, case, whitespace', () => {
    expect(normalizeMemoryLine('- 2026-06-11 Use   session   TOKENS')).toBe('use session tokens');
    expect(normalizeMemoryLine('use session tokens')).toBe('use session tokens');
  });

  it('creates the section + whole file when empty, dated', () => {
    const r = appendMemoryLine('', 'Decisions', 'Use session tokens', D);
    expect(r).toEqual({ content: '## Decisions\n- 2026-06-11 Use session tokens', changed: true, status: 'added' });
  });

  it('creates a section after existing content without touching the brief/fitness line', () => {
    const r = appendMemoryLine('# Brief\n\nfitness: npm test', 'Constraints', 'Node 20 floor', D);
    expect(r.content).toBe('# Brief\n\nfitness: npm test\n\n## Constraints\n- 2026-06-11 Node 20 floor');
    expect(r.status).toBe('added');
  });

  it('appends under an existing section as the last entry', () => {
    const r = appendMemoryLine('## Decisions\n- 2026-06-10 Old one', 'Decisions', 'New one', D);
    expect(r.content).toBe('## Decisions\n- 2026-06-10 Old one\n- 2026-06-11 New one');
  });

  it('skips an exact duplicate', () => {
    const r = appendMemoryLine('## Decisions\n- 2026-06-11 Use session tokens', 'Decisions', 'Use session tokens', D);
    expect(r).toEqual({ content: '## Decisions\n- 2026-06-11 Use session tokens', changed: false, status: 'duplicate' });
  });

  it('skips a near-duplicate (case/whitespace/date drift)', () => {
    const r = appendMemoryLine('## Decisions\n- 2026-06-10 use   SESSION tokens', 'Decisions', 'Use session   tokens', D);
    expect(r.changed).toBe(false);
    expect(r.status).toBe('duplicate');
  });

  it('dedup is section-scoped — same text in a different section still lands', () => {
    const r = appendMemoryLine('## Decisions\n- 2026-06-11 Node 20 floor', 'Constraints', 'Node 20 floor', D);
    expect(r.changed).toBe(true);
    expect(r.content).toBe('## Decisions\n- 2026-06-11 Node 20 floor\n\n## Constraints\n- 2026-06-11 Node 20 floor');
  });

  it('caps the section at 30, dropping the oldest, newest lands last', () => {
    const existing = '## Decisions\n' + Array.from({ length: 30 }, (_, i) => `- 2026-06-01 entry ${i}`).join('\n');
    const r = appendMemoryLine(existing, 'Decisions', 'newest', D);
    expect(r.status).toBe('evicted');
    const entries = r.content.split('\n').filter((l) => l.startsWith('- '));
    expect(entries.length).toBe(30);
    expect(r.content.includes('entry 0\n')).toBe(false); // oldest dropped
    expect(r.content.includes('entry 29')).toBe(true);
    expect(r.content.endsWith('- 2026-06-11 newest')).toBe(true);
  });
});

describe('SaveMemory — tool definition + gates', () => {
  const tool = createSaveMemoryTool();

  it('advertises a non-read-only SaveMemory tool with the section enum', () => {
    expect(tool.definition.name).toBe('SaveMemory');
    expect(tool.definition.isReadOnly).toBe(false);
    const sections = (tool.definition.inputSchema as any).properties.section.enum;
    expect(sections).toEqual(['Decisions', 'Constraints', 'Conventions', 'Session Notes']);
  });

  it('validate rejects missing memory / unknown section, accepts a good call', () => {
    expect(tool.validate({ memory: 'x', section: 'Decisions' }, ctx('/tmp'))).toBeNull();
    expect(typeof tool.validate({ section: 'Decisions' }, ctx('/tmp'))).toBe('string');
    expect(typeof tool.validate({ memory: 'x', section: 'Nonsense' }, ctx('/tmp'))).toBe('string');
  });

  it('checkPermission ALWAYS asks (the confirm gate) and surfaces the line + section', () => {
    const d = tool.checkPermission({ memory: 'Use session tokens', section: 'Decisions' }, ctx('/tmp'));
    expect(d.behavior).toBe('ask');
    expect(d.message).toContain('Use session tokens');
    expect(d.message).toContain('Decisions');
  });
});

describe('SaveMemory — execute against the filesystem', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agon-savemem-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const tool = createSaveMemoryTool();
  const memPath = () => join(dir, '.agon', 'project.md');

  it('creates .agon/project.md and writes a dated entry', async () => {
    const r = await tool.execute({ memory: 'Use session tokens', section: 'Decisions' }, ctx(dir));
    expect(r.ok).toBe(true);
    const body = readFileSync(memPath(), 'utf-8');
    expect(body).toContain('## Decisions');
    expect(body).toMatch(/- \d{4}-\d{2}-\d{2} Use session tokens/);
  });

  it('second identical save is a no-op (near-dup skipped)', async () => {
    await tool.execute({ memory: 'Use session tokens', section: 'Decisions' }, ctx(dir));
    const r2 = await tool.execute({ memory: 'use   session   TOKENS', section: 'Decisions' }, ctx(dir));
    expect(r2.ok).toBe(true);
    expect(r2.content.toLowerCase()).toContain('skipped');
    const entries = readFileSync(memPath(), 'utf-8').split('\n').filter((l) => l.startsWith('- '));
    expect(entries.length).toBe(1);
  });

  it('preserves a pre-existing fitness: line so gate discovery still works', async () => {
    mkdirSync(join(dir, '.agon'), { recursive: true });
    writeFileSync(memPath(), '# Brief\n\nfitness: npm run gate\n');
    await tool.execute({ memory: 'Node 20 floor', section: 'Constraints' }, ctx(dir));
    const body = readFileSync(memPath(), 'utf-8');
    expect(parseFitnessLine(body)).toBe('npm run gate');
    expect(body).toContain('## Constraints');
  });
});

describe('SaveMemory — [PROJECT MEMORY] prompt block', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'agon-savemem-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('extracts only the memory sections, in canonical order', () => {
    const doc = '# Brief\n\nfitness: npm test\n\n## Conventions\n- 2026-06-11 conventional commits\n\n## Decisions\n- 2026-06-11 session tokens\n';
    expect(extractProjectMemorySections(doc)).toBe(
      '### Decisions\n- 2026-06-11 session tokens\n### Conventions\n- 2026-06-11 conventional commits',
    );
    expect(extractProjectMemorySections('fitness: npm test')).toBe('');
  });

  it('builds a labeled block when project.md has memory; no block when absent', () => {
    expect(buildProjectMemoryBlock(dir)).toBe(''); // file absent → no block
    mkdirSync(join(dir, '.agon'), { recursive: true });
    writeFileSync(join(dir, '.agon', 'project.md'), '## Decisions\n- 2026-06-11 session tokens\n');
    const block = buildProjectMemoryBlock(dir);
    expect(block).toContain('[PROJECT MEMORY]');
    expect(block).toContain('### Decisions');
    expect(block).toContain('session tokens');
  });

  it('no block when project.md has only a brief / fitness line (no memory sections)', () => {
    mkdirSync(join(dir, '.agon'), { recursive: true });
    writeFileSync(join(dir, '.agon', 'project.md'), '# Brief\n\nfitness: npm test\n');
    expect(buildProjectMemoryBlock(dir)).toBe('');
  });
});
