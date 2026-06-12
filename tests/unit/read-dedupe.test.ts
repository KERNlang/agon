// ── Feature 1: READ DEDUPE — session-loop integration tests ───────────
//
// Drives the SAME fake-dispatch harness as guards-integration / persistent-
// session: createResumeSession (API path) with apiStreamDispatchWithHistory
// mocked per turn + a fake onToolCall. Asserts the mode-independent Read dedupe
// wired into the session loop (packages/core/session-resume.kern):
//   • identical re-Read of an UNCHANGED file → tier-1 stub (bytes NOT re-fed)
//   • file touched between reads (mtime differs) → full re-feed
//   • Edit-to-path between reads → full re-feed (explicit invalidation)
//   • Bash between reads → full re-feed (whole-cache invalidation)
//   • tier-2: a >8KB first read (disk-cached) folded out → stub → RetrieveResult
//   • kill-switch AGON_READ_DEDUPE=off → always full
//   • stat-fail (file deleted) → normal execution path, no throw from dedupe

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';
import { mkdtempSync, writeFileSync, utimesSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const apiStreamDispatchWithHistoryMock = vi.hoisted(() => vi.fn());

vi.mock('../../packages/core/src/generated/api/dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/core/src/generated/api/dispatch.js')>();
  return {
    ...actual,
    apiStreamDispatchWithHistory: apiStreamDispatchWithHistoryMock,
  };
});

// One structured Read call (the loop executes from the structured part).
async function* streamRead(filePath: string, seq: number) {
  const args = { file_path: filePath };
  yield `\n<tool name="Read">${JSON.stringify(args)}</tool>\n`;
  return { parts: [{ kind: 'tool_call', toolName: 'Read', toolCallId: `call_r_${seq}`, args }] };
}

// A slice read (offset/limit args) — distinct cacheKey from a whole-file Read.
async function* streamReadSlice(filePath: string, seq: number, offset: number, limit: number) {
  const args = { file_path: filePath, offset, limit };
  yield `\n<tool name="Read">${JSON.stringify(args)}</tool>\n`;
  return { parts: [{ kind: 'tool_call', toolName: 'Read', toolCallId: `call_rs_${seq}`, args }] };
}

async function* streamEdit(filePath: string, seq: number) {
  const args = { file_path: filePath, old_string: 'a', new_string: 'b' };
  yield `\n<tool name="Edit">${JSON.stringify(args)}</tool>\n`;
  return { parts: [{ kind: 'tool_call', toolName: 'Edit', toolCallId: `call_e_${seq}`, args }] };
}

async function* streamBash(command: string, seq: number) {
  const args = { command };
  yield `\n<tool name="Bash">${JSON.stringify(args)}</tool>\n`;
  return { parts: [{ kind: 'tool_call', toolName: 'Bash', toolCallId: `call_b_${seq}`, args }] };
}

async function* streamText(text: string) {
  yield text;
  return {};
}

function apiEngine(id: string) {
  return {
    id,
    // NO guards field → strict (the dedupe is mode-independent, so strict is the
    // cleanest place to prove it works without the pipeline interfering).
    api: { baseURL: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'api-test' },
  } as any;
}

const READ_TOOLS = [
  { type: 'function', function: { name: 'Read', description: 'r', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'Edit', description: 'e', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'Bash', description: 'b', parameters: { type: 'object', properties: {} } } },
] as any;

async function drain(gen: AsyncGenerator<any>) {
  const chunks: any[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

let fixtureDir: string;
let filePath: string;

beforeEach(() => {
  fixtureDir = mkdtempSync(join(tmpdir(), 'read-dedupe-'));
  filePath = join(fixtureDir, 'target.ts');
  writeFileSync(filePath, 'export const x = 1;\n');
});

afterEach(() => {
  apiStreamDispatchWithHistoryMock.mockReset();
  try { rmSync(fixtureDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

function toolResultsOf(session: any): string[] {
  return session.getMessageHistory()
    .filter((m: any) => m.role === 'tool')
    .map((m: any) => String(m.content));
}

describe('Read dedupe — tier 1 (unchanged, still in context)', () => {
  it('identical re-Read of an unchanged file → tier-1 stub; full bytes NOT re-fed', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    let reads = 0;
    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => streamRead(filePath, 1))
      .mockImplementationOnce(() => streamRead(filePath, 2)) // identical re-read → stub
      .mockImplementationOnce(() => streamText('Done.'));

    const session = createResumeSession({
      engine: apiEngine('dedupe-tier1'),
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: READ_TOOLS,
      onToolCall: async (name: string) => { reads++; return `FULL FILE BYTES read ${reads}`; },
      toolLoopBaseBudget: 6,
      toolLoopMaxBudget: 6,
    });

    await session.start();
    await drain(session.send({ message: 'read twice', toolLoopBaseBudget: 6, toolLoopMaxBudget: 6 }));

    // onToolCall ran ONCE — the re-read was deduped before execution.
    expect(reads).toBe(1);
    const results = toolResultsOf(session);
    expect(results.length).toBe(2);
    expect(results[0]).toContain('FULL FILE BYTES read 1');
    expect(results[1]).toMatch(/^\[unchanged since read call_r_1 — full content \(\d+ bytes\) is already in context above/);
    expect(results[1]).not.toContain('read 2');
  });

  // nit 4 (claude 0.8): a slice read (offset/limit args) caches ONLY that slice's
  // bytes, not the whole file — the tier-1 stub must say "slice", never "full content".
  it('identical re-Read of an unchanged SLICE → tier-1 stub says "slice", not "full content"', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    let reads = 0;
    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => streamReadSlice(filePath, 1, 0, 5))
      .mockImplementationOnce(() => streamReadSlice(filePath, 2, 0, 5)) // identical slice re-read → stub
      .mockImplementationOnce(() => streamText('Done.'));

    const session = createResumeSession({
      engine: apiEngine('dedupe-slice'),
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: READ_TOOLS,
      onToolCall: async () => { reads++; return `SLICE BYTES read ${reads}`; },
      toolLoopBaseBudget: 6,
      toolLoopMaxBudget: 6,
    });

    await session.start();
    await drain(session.send({ message: 'read the same slice twice', toolLoopBaseBudget: 6, toolLoopMaxBudget: 6 }));

    expect(reads).toBe(1); // the re-read was deduped before execution
    const results = toolResultsOf(session);
    expect(results.length).toBe(2);
    expect(results[1]).toMatch(/^\[unchanged since read call_rs_1 — slice \(\d+ bytes\) is already in context above/);
    expect(results[1]).not.toContain('full content');
  });
});

describe('Read dedupe — invalidation', () => {
  it('file touched between reads (mtime differs) → full re-feed', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    let reads = 0;
    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => streamRead(filePath, 1))
      .mockImplementationOnce(async function* () {
        // Bump the file's mtime by 5s before the second read is dispatched.
        const future = new Date(Date.now() + 5000);
        utimesSync(filePath, future, future);
        yield `\n<tool name="Read">${JSON.stringify({ file_path: filePath })}</tool>\n`;
        return { parts: [{ kind: 'tool_call', toolName: 'Read', toolCallId: 'call_r_2', args: { file_path: filePath } }] };
      })
      .mockImplementationOnce(() => streamText('Done.'));

    const session = createResumeSession({
      engine: apiEngine('dedupe-mtime'),
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: READ_TOOLS,
      onToolCall: async () => { reads++; return `FULL FILE BYTES read ${reads}`; },
      toolLoopBaseBudget: 6,
      toolLoopMaxBudget: 6,
    });

    await session.start();
    await drain(session.send({ message: 'read, touch, read', toolLoopBaseBudget: 6, toolLoopMaxBudget: 6 }));

    // Both reads executed — the mtime change forced a MISS.
    expect(reads).toBe(2);
    const results = toolResultsOf(session);
    expect(results[1]).toContain('FULL FILE BYTES read 2');
    expect(results.some(r => /unchanged since read/.test(r))).toBe(false);
  });

  it('Edit-to-path between reads → full re-feed (path-scoped invalidation)', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    let reads = 0;
    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => streamRead(filePath, 1))
      .mockImplementationOnce(() => streamEdit(filePath, 1)) // edits the path → clears its Read entry
      .mockImplementationOnce(() => streamRead(filePath, 2)) // must re-feed
      .mockImplementationOnce(() => streamText('Done.'));

    const session = createResumeSession({
      engine: apiEngine('dedupe-edit'),
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: READ_TOOLS,
      onToolCall: async (name: string) => {
        if (name === 'Read') { reads++; return `FULL FILE BYTES read ${reads}`; }
        return 'ok';
      },
      toolLoopBaseBudget: 8,
      toolLoopMaxBudget: 8,
    });

    await session.start();
    await drain(session.send({ message: 'read, edit, read', toolLoopBaseBudget: 8, toolLoopMaxBudget: 8 }));

    expect(reads).toBe(2);
    const results = toolResultsOf(session);
    expect(results.some(r => /FULL FILE BYTES read 2/.test(r))).toBe(true);
    expect(results.some(r => /unchanged since read/.test(r))).toBe(false);
  });

  it('Bash between reads → full re-feed (whole-cache invalidation)', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    let reads = 0;
    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => streamRead(filePath, 1))
      .mockImplementationOnce(() => streamBash('echo hi', 1)) // a command can touch anything → clear all
      .mockImplementationOnce(() => streamRead(filePath, 2)) // must re-feed
      .mockImplementationOnce(() => streamText('Done.'));

    const session = createResumeSession({
      engine: apiEngine('dedupe-bash'),
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: READ_TOOLS,
      onToolCall: async (name: string) => {
        if (name === 'Read') { reads++; return `FULL FILE BYTES read ${reads}`; }
        return 'bash output';
      },
      toolLoopBaseBudget: 8,
      toolLoopMaxBudget: 8,
    });

    await session.start();
    await drain(session.send({ message: 'read, bash, read', toolLoopBaseBudget: 8, toolLoopMaxBudget: 8 }));

    expect(reads).toBe(2);
    const results = toolResultsOf(session);
    expect(results.some(r => /FULL FILE BYTES read 2/.test(r))).toBe(true);
    expect(results.some(r => /unchanged since read/.test(r))).toBe(false);
  });
});

describe('Read dedupe — tier 2 (folded out, retrievable)', () => {
  it('a >8KB first read (disk-cached) compacted out → stub points at RetrieveResult', async () => {
    // AGON_HOME so the disk cache is isolated + the RetrieveResult check finds it.
    const home = setupTestAgonHome('read-dedupe-tier2');
    const prevDisable = process.env.AGON_DISABLE_LLM_COMPACTION;
    process.env.AGON_DISABLE_LLM_COMPACTION = '1'; // deterministic regex compaction, no HTTP
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
      const BIG = 'X'.repeat(9000); // > INLINE_LIMIT (8192) → disk-cached on push

      let targetReads = 0; // executions of the BIG target.ts read specifically
      const session = createResumeSession({
        engine: apiEngine('dedupe-tier2'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: READ_TOOLS,
        sessionContinuity: true,
        onToolCall: async (name: string, args: Record<string, unknown>) => {
          if (name !== 'Read') return 'ok';
          if (String((args as any).file_path) === filePath) { targetReads++; return `${BIG} (target read ${targetReads})`; }
          return 'small filler contents';
        },
        toolLoopBaseBudget: 6,
        toolLoopMaxBudget: 6,
      });

      await session.start();

      // Turn 1: one big read (disk-cached) then finish.
      apiStreamDispatchWithHistoryMock
        .mockImplementationOnce(() => streamRead(filePath, 1))
        .mockImplementationOnce(() => streamText('Read the big file.'));
      await drain(session.send({ message: 'read the big file', toolLoopBaseBudget: 6, toolLoopMaxBudget: 6 }));
      apiStreamDispatchWithHistoryMock.mockReset();

      // Filler turns: read OTHER small files so the big read falls OUTSIDE the
      // verbatim keep-tail (COMPACT_KEEP_TAIL = 8 messages) → it lands in the
      // `old` segment doCompact folds out.
      for (let t = 0; t < 3; t++) {
        const other = join(fixtureDir, `other-${t}.ts`);
        writeFileSync(other, `export const y${t} = ${t};\n`);
        apiStreamDispatchWithHistoryMock
          .mockImplementationOnce(() => streamRead(other, 100 + t))
          .mockImplementationOnce(() => streamText(`Read other ${t}.`));
        await drain(session.send({ message: `read other ${t}`, toolLoopBaseBudget: 6, toolLoopMaxBudget: 6 }));
        apiStreamDispatchWithHistoryMock.mockReset();
      }

      // Compact in place — this folds turn 1's big read out of context. The tool
      // message already carries a [cached — call_r_1] ref (disk-cached on push),
      // so the fold marks call_r_1 compacted + retrievable via that id.
      const compactResult = await session.compact();
      expect(compactResult.method).not.toBe('none'); // it actually folded an old segment

      // Turn 2: re-read the SAME unchanged file → tier-2 stub at RetrieveResult.
      apiStreamDispatchWithHistoryMock
        .mockImplementationOnce(() => streamRead(filePath, 2))
        .mockImplementationOnce(() => streamText('Done.'));
      await drain(session.send({ message: 'read it again', toolLoopBaseBudget: 6, toolLoopMaxBudget: 6 }));

      // The big target.ts re-read did NOT execute (deduped) — only the turn-1
      // read of target.ts ran — and the stub points at RetrieveResult.
      expect(targetReads).toBe(1);
      const results = toolResultsOf(session);
      const tier2 = results.find(r => /compacted out of context; call RetrieveResult with id/.test(r));
      expect(tier2).toBeDefined();
      expect(tier2).toMatch(/call RetrieveResult with id "call_r_1"/);
    } finally {
      if (prevDisable === undefined) delete process.env.AGON_DISABLE_LLM_COMPACTION;
      else process.env.AGON_DISABLE_LLM_COMPACTION = prevDisable;
      cleanupTestAgonHome(home);
    }
  }, 25000);
});

describe('Read dedupe — large-result marker format folded by compact() (codex FIX 1)', () => {
  // codex FIX 1: markOldSegmentCompacted's id-extraction regex must match BOTH the
  // simple `[cached — id]` marker AND the large-result `[N lines, M chars — cached —
  // id]` marker the >INLINE_LIMIT tool-result push writes. This test drives the
  // strict normal-path push (which writes the LARGE format), folds it via compact(),
  // and asserts the unchanged re-read still resolves to the tier-2 RetrieveResult
  // stub (not a tier-3 full re-execute). It also asserts the marker actually written
  // to history is the large-result shape, so a regression to the simple-only push
  // would surface here. (Note: the strict read path also pre-wires retrievability at
  // record time via refreshReadEntry, so this primarily LOCKS IN the regex contract
  // as a backstop and guards against future regressions in either path.)
  it('a >8KB read written with the [N lines, M chars — cached — id] marker still re-reads as tier-2 after a fold', async () => {
    const home = setupTestAgonHome('read-dedupe-largefmt');
    const prevDisable = process.env.AGON_DISABLE_LLM_COMPACTION;
    process.env.AGON_DISABLE_LLM_COMPACTION = '1'; // deterministic regex compaction, no HTTP
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
      const BIG = 'X'.repeat(9000); // > INLINE_LIMIT (8192) → disk-cached + truncated on push

      let targetReads = 0;
      const session = createResumeSession({
        engine: apiEngine('dedupe-largefmt'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: READ_TOOLS,
        sessionContinuity: true,
        onToolCall: async (name: string, args: Record<string, unknown>) => {
          if (name !== 'Read') return 'ok';
          if (String((args as any).file_path) === filePath) { targetReads++; return `${BIG} (target read ${targetReads})`; }
          return 'small filler contents';
        },
        toolLoopBaseBudget: 6,
        toolLoopMaxBudget: 6,
      });

      await session.start();

      // Turn 1: one big read. The strict normal-path push writes the LARGE-RESULT
      // marker `[N lines, M chars — cached — call_r_1]` into the tool message.
      apiStreamDispatchWithHistoryMock
        .mockImplementationOnce(() => streamRead(filePath, 1))
        .mockImplementationOnce(() => streamText('Read the big file.'));
      await drain(session.send({ message: 'read the big file', toolLoopBaseBudget: 6, toolLoopMaxBudget: 6 }));
      apiStreamDispatchWithHistoryMock.mockReset();

      // Assert the marker actually written is the LARGE-result shape (the format
      // the FIX 1 regex must now cover) — not the simple `[cached — id]`. (The 9000-char
      // body is truncated to slice(0,2048) on push, so the `(target read 1)` suffix is
      // cut off; identify the message by its cached-call_r_1 marker.)
      const bigToolMsg = toolResultsOf(session).find(r => /cached — call_r_1\]/.test(r));
      expect(bigToolMsg).toBeDefined();
      expect(bigToolMsg).toMatch(/\[\d+ lines, \d+ chars — cached — call_r_1\]/);

      // Filler turns push the big read out of the verbatim keep-tail.
      for (let t = 0; t < 3; t++) {
        const other = join(fixtureDir, `other-${t}.ts`);
        writeFileSync(other, `export const y${t} = ${t};\n`);
        apiStreamDispatchWithHistoryMock
          .mockImplementationOnce(() => streamRead(other, 100 + t))
          .mockImplementationOnce(() => streamText(`Read other ${t}.`));
        await drain(session.send({ message: `read other ${t}`, toolLoopBaseBudget: 6, toolLoopMaxBudget: 6 }));
        apiStreamDispatchWithHistoryMock.mockReset();
      }

      // Fold the big read out — markOldSegmentCompacted must extract call_r_1 from
      // the LARGE-result marker so it stays retrievable (tier 2).
      const compactResult = await session.compact();
      expect(compactResult.method).not.toBe('none');

      // Turn 2: unchanged re-read → tier-2 RetrieveResult stub, NOT a tier-3 re-execute.
      apiStreamDispatchWithHistoryMock
        .mockImplementationOnce(() => streamRead(filePath, 2))
        .mockImplementationOnce(() => streamText('Done.'));
      await drain(session.send({ message: 'read it again', toolLoopBaseBudget: 6, toolLoopMaxBudget: 6 }));

      expect(targetReads).toBe(1); // deduped — no tier-3 full re-execute
      const tier2 = toolResultsOf(session).find(r => /compacted out of context; call RetrieveResult with id "call_r_1"/.test(r));
      expect(tier2).toBeDefined();
    } finally {
      if (prevDisable === undefined) delete process.env.AGON_DISABLE_LLM_COMPACTION;
      else process.env.AGON_DISABLE_LLM_COMPACTION = prevDisable;
      cleanupTestAgonHome(home);
    }
  }, 25000);
});

describe('Read dedupe — large read truncated in-send (tier-1 lie regression)', () => {
  it('a >8KB read truncated inline → unchanged re-read gets tier-2 (RetrieveResult), NOT tier-1', async () => {
    // REGRESSION: a >INLINE_LIMIT read is pushed to history as slice(0,2048)+[cached],
    // so its FULL content never sits inline. Before the fix, the in-send truncation
    // never marked the callId compacted, so an unchanged re-read got the tier-1 stub
    // ("full content is already in context above") — a LIE: only 2048 chars are there.
    // refreshReadEntry now marks the large-read callId compacted+retrievable at record
    // time, so the re-read takes tier-2 (point at RetrieveResult) instead. NO compaction
    // happens here — the bug fired on the in-send truncation path alone.
    const home = setupTestAgonHome('read-dedupe-tier1-lie');
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
      const BIG = 'X'.repeat(9000); // > INLINE_LIMIT (8192) → disk-cached + truncated on push

      let reads = 0;
      apiStreamDispatchWithHistoryMock
        .mockImplementationOnce(() => streamRead(filePath, 1))
        .mockImplementationOnce(() => streamRead(filePath, 2)) // identical re-read, same turn
        .mockImplementationOnce(() => streamText('Done.'));

      const session = createResumeSession({
        engine: apiEngine('dedupe-tier1-lie'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: READ_TOOLS,
        onToolCall: async (name: string) => { reads++; return `${BIG} (read ${reads})`; },
        toolLoopBaseBudget: 6,
        toolLoopMaxBudget: 6,
      });

      await session.start();
      await drain(session.send({ message: 'read the big file twice', toolLoopBaseBudget: 6, toolLoopMaxBudget: 6 }));

      // The re-read was deduped before executing (onToolCall ran once for the big read).
      expect(reads).toBe(1);
      const results = toolResultsOf(session);
      // The dedupe stub MUST be tier-2 (RetrieveResult), NOT the tier-1 "in context above" lie.
      const stub = results.find(r => /unchanged since read call_r_1/.test(r));
      expect(stub).toBeDefined();
      expect(stub).toMatch(/compacted out of context; call RetrieveResult with id "call_r_1"/);
      expect(stub).not.toMatch(/full content .* is already in context above/);
    } finally {
      cleanupTestAgonHome(home);
    }
  });
});

describe('Read dedupe — kill-switch + stat-fail', () => {
  it('kill-switch AGON_READ_DEDUPE=off → both reads execute fully', async () => {
    const prev = process.env.AGON_READ_DEDUPE;
    process.env.AGON_READ_DEDUPE = 'off';
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
      let reads = 0;
      apiStreamDispatchWithHistoryMock
        .mockImplementationOnce(() => streamRead(filePath, 1))
        .mockImplementationOnce(() => streamRead(filePath, 2))
        .mockImplementationOnce(() => streamText('Done.'));

      const session = createResumeSession({
        engine: apiEngine('dedupe-killswitch'),
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: READ_TOOLS,
        onToolCall: async () => { reads++; return `read ${reads}`; },
        toolLoopBaseBudget: 6,
        toolLoopMaxBudget: 6,
      });

      await session.start();
      await drain(session.send({ message: 'read twice', toolLoopBaseBudget: 6, toolLoopMaxBudget: 6 }));

      expect(reads).toBe(2);
      expect(toolResultsOf(session).some(r => /unchanged since read/.test(r))).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.AGON_READ_DEDUPE;
      else process.env.AGON_READ_DEDUPE = prev;
    }
  });

  it('stat-fail (file deleted between reads) → normal execution, no throw from dedupe', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    let reads = 0;
    apiStreamDispatchWithHistoryMock
      .mockImplementationOnce(() => streamRead(filePath, 1))
      .mockImplementationOnce(async function* () {
        // Delete the file before the second read → statSync fails → clean MISS.
        rmSync(filePath, { force: true });
        yield `\n<tool name="Read">${JSON.stringify({ file_path: filePath })}</tool>\n`;
        return { parts: [{ kind: 'tool_call', toolName: 'Read', toolCallId: 'call_r_2', args: { file_path: filePath } }] };
      })
      .mockImplementationOnce(() => streamText('Done.'));

    const session = createResumeSession({
      engine: apiEngine('dedupe-statfail'),
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: READ_TOOLS,
      onToolCall: async () => { reads++; return `read ${reads}`; },
      toolLoopBaseBudget: 6,
      toolLoopMaxBudget: 6,
    });

    await session.start();
    const chunks = await drain(session.send({ message: 'read, delete, read', toolLoopBaseBudget: 6, toolLoopMaxBudget: 6 }));

    // Second read executed (stat failed → MISS) and the loop finished cleanly.
    expect(reads).toBe(2);
    expect(chunks.some((c: any) => c.type === 'text' && /Done/.test(String(c.content)))).toBe(true);
    expect(toolResultsOf(session).some(r => /unchanged since read/.test(r))).toBe(false);
  });
});
