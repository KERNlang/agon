// ── Native tool loop — earned budget + cooperative steering yield ──────
//
// Drives the real session-resume native loop through the same fake-dispatch
// harness read-dedupe / guards-integration use (createResumeSession on the API
// path with apiStreamDispatchWithHistory mocked). Two behaviors under test:
//
//   D2  budget growth is EARNED — a Bash-mediated re-read spiral (the observed
//       failure: `cat` bypasses the Read/Grep/Glob ledger entirely) must stay at
//       the base budget instead of climbing to the cap, while a genuine mapping
//       pass that keeps reading NEW files keeps earning.
//   D5  opts.shouldYield ends the cycle cleanly at a completed tool-pair
//       boundary: the step's result is kept, nothing in flight is aborted, and
//       the done chunk carries the distinct 'steering-yield' reason.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

const apiStreamDispatchWithHistoryMock = vi.hoisted(() => vi.fn());

vi.mock('../../packages/core/src/generated/api/dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/core/src/generated/api/dispatch.js')>();
  return {
    ...actual,
    apiStreamDispatchWithHistory: apiStreamDispatchWithHistoryMock,
  };
});

async function* streamBash(command: string, seq: number) {
  const args = { command };
  yield `\n<tool name="Bash">${JSON.stringify(args)}</tool>\n`;
  return { parts: [{ kind: 'tool_call', toolName: 'Bash', toolCallId: `call_b_${seq}`, args }] };
}

async function* streamRead(filePath: string, seq: number) {
  const args = { file_path: filePath };
  yield `\n<tool name="Read">${JSON.stringify(args)}</tool>\n`;
  return { parts: [{ kind: 'tool_call', toolName: 'Read', toolCallId: `call_r_${seq}`, args }] };
}

async function* streamCall(toolName: string, args: Record<string, unknown>, toolCallId: string) {
  yield `\n<tool name="${toolName}">${JSON.stringify(args)}</tool>\n`;
  return { parts: [{ kind: 'tool_call', toolName, toolCallId, args }] };
}

async function* streamText(text: string) {
  yield text;
  return {};
}

function apiEngine(id: string, guards?: 'strict' | 'invariants' | 'shadow') {
  return {
    id,
    api: { baseURL: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'api-test' },
    ...(guards ? { guards } : {}),
  } as any;
}

const TOOLS = [
  { type: 'function', function: { name: 'Read', description: 'r', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'Bash', description: 'b', parameters: { type: 'object', properties: {} } } },
] as any;

async function drain(gen: AsyncGenerator<any>) {
  const chunks: any[] = [];
  for await (const chunk of gen) chunks.push(chunk);
  return chunks;
}

let home: string;

beforeEach(() => {
  home = setupTestAgonHome('native-loop-guards');
});

afterEach(() => {
  apiStreamDispatchWithHistoryMock.mockReset();
  cleanupTestAgonHome(home);
});

describe('earned budget — read-repeats never grow the loop', () => {
  it('keeps a Bash `cat` re-read spiral at the BASE budget (never climbs to the cap)', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    let seq = 0;
    let executed = 0;
    apiStreamDispatchWithHistoryMock.mockImplementation(() => streamBash('cat packages/core/src/index.ts', ++seq));

    const session = createResumeSession({
      engine: apiEngine('earned-budget-repeat'),
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: TOOLS,
      onToolCall: async () => { executed++; return 'export const x = 1;'; },
    });

    await session.start();
    await drain(session.send({ message: 'map it', toolLoopBaseBudget: 6, toolLoopMaxBudget: 30 }));

    // Only the FIRST cat is novel; every later step is a read-repeat and earns
    // nothing, so the budget stays at 6 instead of ratcheting toward 30.
    expect(executed).toBe(6);
  });

  it('lets a genuine mapping pass (new file each step) keep earning growth', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    let seq = 0;
    let executed = 0;
    apiStreamDispatchWithHistoryMock.mockImplementation(() => {
      seq++;
      return streamBash(`cat packages/core/src/file-${seq}.ts`, seq);
    });

    const session = createResumeSession({
      engine: apiEngine('earned-budget-novel'),
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: TOOLS,
      onToolCall: async () => { executed++; return 'export const x = 1;'; },
    });

    await session.start();
    await drain(session.send({ message: 'map it', toolLoopBaseBudget: 6, toolLoopMaxBudget: 12 }));

    // Every step deposits novelty → +2 per 3 earning steps up to the cap.
    expect(executed).toBe(12);
  });

  it('lets verification steps earn growth even when the command repeats', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    let seq = 0;
    let executed = 0;
    apiStreamDispatchWithHistoryMock.mockImplementation(() => streamBash('npm test', ++seq));

    const session = createResumeSession({
      engine: apiEngine('earned-budget-verify'),
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: TOOLS,
      onToolCall: async () => { executed++; return 'all tests pass'; },
    });

    await session.start();
    await drain(session.send({
      message: 'verify it',
      toolLoopBaseBudget: 6,
      toolLoopMaxBudget: 12,
      // The caller's discovered gate — what makes `npm test` verify, not a read.
      gateMatchers: ['npm test', 'npm run test', 'vitest'],
    }));

    expect(executed).toBe(12);
  });
});

describe('cooperative steering yield', () => {
  it('ends the cycle after the current tool pair with done reason steering-yield', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    let seq = 0;
    let executed = 0;
    apiStreamDispatchWithHistoryMock.mockImplementation(() => streamRead(`f${++seq}.ts`, seq));

    const session = createResumeSession({
      engine: apiEngine('steering-yield'),
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: TOOLS,
      onToolCall: async () => { executed++; return 'file body'; },
    });

    await session.start();
    // Nothing queued yet: the same hook, unarmed, must not change the turn.
    let pending = false;
    const chunks = await drain(session.send({
      message: 'read everything',
      toolLoopBaseBudget: 10,
      toolLoopMaxBudget: 10,
      shouldYield: () => pending,
    }));

    // Nothing armed → the loop runs to its budget and ends normally.
    expect(executed).toBe(10);
    const done = chunks.filter((c) => c.type === 'done');
    expect(done.at(-1)?.content).toBe('end_turn');

    // Now arm the yield and run a second turn.
    pending = true;
    executed = 0;
    const yielded = await drain(session.send({
      message: 'read everything again',
      toolLoopBaseBudget: 10,
      toolLoopMaxBudget: 10,
      shouldYield: () => pending,
    }));

    expect(executed).toBe(1); // exactly one completed tool pair
    const doneChunks = yielded.filter((c) => c.type === 'done');
    expect(doneChunks).toHaveLength(1);
    expect(doneChunks[0].content).toBe('steering-yield');
    // Nothing aborted, no error surfaced, and the step's result was kept.
    expect(yielded.some((c) => c.type === 'error')).toBe(false);
    const history = session.getMessageHistory();
    const toolResults = history.filter((m: any) => m.role === 'tool');
    expect(toolResults.at(-1)?.content).toContain('file body');
    expect(history.at(-1)?.content).toContain('handing the turn back for user steering');
    expect(yielded.some((c) => c.type === 'status' && String(c.content).includes('pausing for your steering'))).toBe(true);
  });

  it('treats a throwing shouldYield as "keep going" (never breaks the turn)', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    let seq = 0;
    let executed = 0;
    apiStreamDispatchWithHistoryMock.mockImplementation(() => streamRead(`g${++seq}.ts`, seq));

    const session = createResumeSession({
      engine: apiEngine('steering-yield-throws'),
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: TOOLS,
      onToolCall: async () => { executed++; return 'file body'; },
    });

    await session.start();
    const chunks = await drain(session.send({
      message: 'read everything',
      toolLoopBaseBudget: 4,
      toolLoopMaxBudget: 4,
      shouldYield: () => { throw new Error('peek exploded'); },
    }));

    expect(executed).toBe(4);
    expect(chunks.filter((c) => c.type === 'done').at(-1)?.content).toBe('end_turn');
  });
});

// ── Review follow-up: the yield promise must hold at EVERY completed pair ──
// The main exec path is not the only boundary where a step's tool results land
// in history and the loop dispatches again. The grounded-write block, the strict
// solo-coding gate and the narration auto-exec path each `continue` from their
// own boundary; polling in only one of them meant a caller waiting for the cycle
// back could wait several more calls depending on which guard happened to fire
// (codex review #3). Each branch is driven for real here, not asserted on source.
describe('cooperative yield coverage at every completed tool-pair boundary', () => {
  const WRITE_TOOLS_DEF = [
    { type: 'function', function: { name: 'Edit', description: 'e', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'Write', description: 'w', parameters: { type: 'object', properties: {} } } },
    { type: 'function', function: { name: 'Read', description: 'r', parameters: { type: 'object', properties: {} } } },
  ] as any;

  it('yields at the grounded-write block boundary (invariants mode)', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    const executed: string[] = [];
    // An Edit to an EXISTING file the session never read → grounded-write blocks
    // it, and the branch continues from its own boundary.
    apiStreamDispatchWithHistoryMock.mockImplementation(() =>
      streamCall('Edit', { file_path: 'package.json', old_string: 'a', new_string: 'b' }, 'call_gw_1'));

    const session = createResumeSession({
      engine: apiEngine('yield-grounded-write', 'invariants'),
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: WRITE_TOOLS_DEF,
      onToolCall: async (name: string) => { executed.push(name); return 'ok'; },
    });

    await session.start();
    const chunks = await drain(session.send({
      message: 'edit the manifest',
      toolLoopBaseBudget: 8,
      toolLoopMaxBudget: 8,
      shouldYield: () => true,
    }));

    expect(executed).toEqual([]); // the write was blocked, nothing ran
    // ONE dispatch: the yield landed at this branch's own boundary, not several
    // steps later once some other path happened to poll.
    expect(apiStreamDispatchWithHistoryMock.mock.calls.length).toBe(1);
    expect(chunks.filter((c) => c.type === 'done').at(-1)?.content).toBe('steering-yield');
    expect(chunks.some((c) => c.type === 'status' && String(c.content).includes('pausing for your steering'))).toBe(true);
    expect(String(session.getMessageHistory().at(-1)?.content)).toContain('handing the turn back for user steering');
  }, 20000);

  it('yields at the strict solo-coding gate boundary', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    const executed: string[] = [];
    apiStreamDispatchWithHistoryMock.mockImplementation(() =>
      streamCall('Write', { file_path: '/tmp/agon-solo-gate-yield.ts', content: 'export const x = 1;' }, 'call_sg_1'));

    const session = createResumeSession({
      engine: apiEngine('yield-solo-gate', 'strict'),
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: WRITE_TOOLS_DEF,
      onToolCall: async (name: string) => { executed.push(name); return 'ok'; },
    });

    await session.start();
    // "refactor … across packages" makes this a COMPLEX task with no prior
    // reads, which is exactly what the strict solo-coding gate blocks on step 1.
    const chunks = await drain(session.send({
      message: 'refactor the session loop across packages',
      toolLoopBaseBudget: 8,
      toolLoopMaxBudget: 8,
      shouldYield: () => true,
    }));

    expect(executed).toEqual([]);
    expect(apiStreamDispatchWithHistoryMock.mock.calls.length).toBe(1);
    expect(chunks.filter((c) => c.type === 'done').at(-1)?.content).toBe('steering-yield');
    expect(String(session.getMessageHistory().at(-1)?.content)).toContain('handing the turn back for user steering');
  }, 20000);

  it('yields at the narration auto-exec boundary (harness executed the intent)', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    let executed = 0;
    // Pure narration, no tool call: the loop extracts the read intent and runs it
    // FOR the model, then continues from that boundary.
    apiStreamDispatchWithHistoryMock.mockImplementation(() =>
      streamText('Let me read packages/core/src/index.ts before deciding.'));

    const session = createResumeSession({
      engine: apiEngine('yield-auto-exec'),
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: TOOLS,
      onToolCall: async () => { executed++; return 'export const x = 1;'; },
    });

    await session.start();
    const chunks = await drain(session.send({
      message: 'what does core export?',
      toolLoopBaseBudget: 8,
      toolLoopMaxBudget: 8,
      shouldYield: () => true,
    }));

    expect(executed).toBe(1); // exactly one auto-executed pair, then the yield
    expect(apiStreamDispatchWithHistoryMock.mock.calls.length).toBe(1);
    expect(chunks.filter((c) => c.type === 'done').at(-1)?.content).toBe('steering-yield');
    expect(String(session.getMessageHistory().at(-1)?.content)).toContain('handing the turn back for user steering');
  }, 20000);
});

// ── Review follow-up: guard branches must EARN budget growth too ──
// Both blocked-write branches used to credit productiveSteps unconditionally, so
// a step whose only executed siblings were re-reads still grew the budget — the
// hole D2 closes on the main path (codex review #4). A blocked write executed
// nothing at all and must never count as a mutation.
describe('earned budget at the blocked-write boundaries', () => {
  it('does not grow the budget on blocked-write steps whose reads are repeats', async () => {
    const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
    let step = 0;
    // Every step: Edit an existing unread file (blocked) + re-Read the SAME file.
    // The read grounds nothing new after the first step, so no step past the
    // first can earn growth and the cycle must stop at the BASE budget.
    apiStreamDispatchWithHistoryMock.mockImplementation(() => {
      step++;
      const args = { file_path: 'package.json', old_string: 'a', new_string: 'b' };
      return (async function* () {
        yield `\n<tool name="Edit">${JSON.stringify(args)}</tool>\n`;
        return {
          parts: [
            { kind: 'tool_call', toolName: 'Edit', toolCallId: `call_e_${step}`, args },
            { kind: 'tool_call', toolName: 'Grep', toolCallId: `call_g_${step}`, args: { pattern: 'name', path: 'package.json' } },
          ],
        };
      })();
    });

    const session = createResumeSession({
      engine: apiEngine('earn-blocked-write', 'invariants'),
      binaryPath: '',
      cwd: process.cwd(),
      systemPrompt: 'You are Cesar.',
      nativeTools: [
        { type: 'function', function: { name: 'Edit', description: 'e', parameters: { type: 'object', properties: {} } } },
        { type: 'function', function: { name: 'Grep', description: 'g', parameters: { type: 'object', properties: {} } } },
      ] as any,
      onToolCall: async () => 'package.json:2:  "name": "agon"',
    });

    await session.start();
    await drain(session.send({ message: 'edit the manifest', toolLoopBaseBudget: 5, toolLoopMaxBudget: 30 }));

    // Base budget 5 → exactly 5 dispatches. Only the FIRST step earns (its Grep
    // is novel); after that the Grep is a repeat and the Edit is blocked, so
    // nothing earns and the budget never ratchets. Before the fix every blocked
    // step credited productiveSteps, granting +2 every third step and running the
    // cycle well past 5.
    expect(apiStreamDispatchWithHistoryMock.mock.calls.length).toBe(5);
  }, 20000);
});
