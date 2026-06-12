import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

// ── Golden strict-mode test (Wiring D3) ────────────────────────────────
// Proves the API session loop is BYTE-IDENTICAL in behavior when guardMode
// resolves to 'strict' (the default — engine def WITHOUT a `guards` field, no
// user config override). The two legacy guards the contract calls out:
//   (i)  the solo-coding gate — a write on a complex task without prior
//        investigation is blocked with the EXACT legacy '[BLOCKED] You haven't
//        investigated' feedback, and
//   (ii) the read-spin breaker — a varying-composition re-read spin (no new
//        cache-keys) is omitted + nudged with the EXACT legacy
//        'Agon detected repeated Read/Grep/Glob' recovery text.
// Both are driven through the SAME fake-dispatch harness the persistent-session
// suite uses (apiStreamDispatchWithHistory mocked to yield <tool> markers).
//
// A third test drives the SAME solo-coding scenario in 'invariants' mode and
// asserts the NEW grounded-write feedback text appears instead of the legacy
// gate text — proving the mode switch actually swaps the guard.

const apiStreamDispatchWithHistoryMock = vi.hoisted(() => vi.fn());

vi.mock('../../packages/core/src/generated/api/dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../packages/core/src/generated/api/dispatch.js')>();
  return {
    ...actual,
    apiStreamDispatchWithHistory: apiStreamDispatchWithHistoryMock,
  };
});

// One read-only step over an explicit file set (varying compositions over the
// same already-seen files defeat the byte-identical-signature guard, so the
// no-new-info counter is the only thing that catches the spin).
async function* streamReadFiles(paths: string[]) {
  const calls = paths.map(p => `<tool name="Read">${JSON.stringify({ file_path: p })}</tool>`).join('\n');
  yield `Let me look at the relevant files again.\n${calls}`;
  return {};
}

// A single Write with no prior reads — the solo-coding / grounded-write trigger.
async function* streamWrite(filePath: string, content: string) {
  yield `<tool name="Write">${JSON.stringify({ file_path: filePath, content })}</tool>`;
  return {};
}

afterEach(() => {
  apiStreamDispatchWithHistoryMock.mockReset();
});

describe('guard strict-mode golden (Wiring D3)', () => {
  it('strict: solo-coding gate blocks an uninvestigated write with the legacy [BLOCKED] text', async () => {
    // Telemetry off keeps the run free of disk writes / AGON_HOME coupling and
    // exercises the byte-identical legacy path.
    const prevTelemetry = process.env.AGON_GUARD_TELEMETRY;
    process.env.AGON_GUARD_TELEMETRY = '0';
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
      // Step 1: write on a complex task without investigating → gate fires.
      // Step 2: finish (the model "investigated" via the block feedback).
      apiStreamDispatchWithHistoryMock
        .mockImplementationOnce(() => streamWrite('src/brand-new-file.ts', 'export const x = 1;'))
        .mockImplementationOnce(async function* () { yield 'Done.'; return {}; });

      let blockedOutput: string | null = null;
      const session = createResumeSession({
        engine: {
          id: 'api-strict-gate',
          // NO `guards` field → resolveGuardMode returns 'strict'.
          api: { baseURL: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'api-test' },
        } as any,
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: [
          { type: 'function', function: { name: 'Write', description: 'w', parameters: { type: 'object', properties: {} } } },
        ] as any,
        onToolCall: async (name: string, _args: unknown, _id: string, ...rest: unknown[]) => {
          void rest;
          return name === 'Write' ? 'wrote' : 'ok';
        },
        toolLoopBaseBudget: 4,
        toolLoopMaxBudget: 4,
      });

      await session.start();
      const chunks: any[] = [];
      for await (const chunk of session.send({
        message: 'refactor the auth module across files and rewrite the token handler',
        toolLoopBaseBudget: 4,
        toolLoopMaxBudget: 4,
      })) {
        chunks.push(chunk);
      }

      // The legacy solo-coding gate status chunk fired.
      expect(chunks.some((c: any) => c.type === 'status' && /solo-coding gate/.test(c.content))).toBe(true);
      // The blocked write's result in history is the EXACT legacy text.
      const history = session.getMessageHistory();
      const blockedToolMsg = history.find((m: any) => m.role === 'tool' && typeof m.content === 'string' && m.content.startsWith('[BLOCKED]'));
      blockedOutput = blockedToolMsg ? String(blockedToolMsg.content) : null;
      expect(blockedOutput).not.toBeNull();
      expect(blockedOutput).toBe(
        "[BLOCKED] You haven't investigated the codebase yet. Call Read/Grep to understand the code first, then decide if this needs Forge or Brainstorm. Do not write code without reading what exists.",
      );
      // The new grounded-write text must NOT appear in strict mode.
      expect(history.some((m: any) => typeof m.content === 'string' && /\[BLOCKED: grounded-write\]/.test(m.content))).toBe(false);
    } finally {
      if (prevTelemetry === undefined) delete process.env.AGON_GUARD_TELEMETRY;
      else process.env.AGON_GUARD_TELEMETRY = prevTelemetry;
    }
  });

  it('strict: read-spin breaker omits the duplicate batch with the legacy recovery text (telemetry OFF)', async () => {
    const prevTelemetry = process.env.AGON_GUARD_TELEMETRY;
    process.env.AGON_GUARD_TELEMETRY = '0';
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
      let readCount = 0;
      apiStreamDispatchWithHistoryMock
        .mockImplementationOnce(() => streamReadFiles(['src/a.ts', 'src/b.ts'])) // new keys → 0
        .mockImplementationOnce(() => streamReadFiles(['src/a.ts']))             // no new → 1
        .mockImplementationOnce(() => streamReadFiles(['src/b.ts']))             // no new → 2
        .mockImplementationOnce(() => streamReadFiles(['src/a.ts', 'src/b.ts'])) // no new → 3 → recovery
        .mockImplementationOnce(async function* () { yield 'Done after recovery.'; return {}; });

      const session = createResumeSession({
        engine: {
          id: 'api-strict-spin',
          api: { baseURL: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'api-test' },
        } as any,
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        onToolCall: async () => { readCount++; return `read-${readCount}`; },
        toolLoopBaseBudget: 6,
        toolLoopMaxBudget: 6,
      });

      await session.start();
      const chunks: any[] = [];
      for await (const chunk of session.send({ message: 'spin', toolLoopBaseBudget: 6, toolLoopMaxBudget: 6 })) {
        chunks.push(chunk);
      }

      // Steps 1-3 executed (2 + 1 + 1 = 4 reads); step 4's duplicate batch omitted.
      expect(readCount).toBe(4);
      // The legacy recovery status chunk fired.
      expect(chunks.some((c: any) => c.type === 'status' && /recovering from repeated stale read loop/.test(c.content))).toBe(true);
      // The EXACT legacy recovery user message landed in history.
      const history = session.getMessageHistory();
      const recoveryMsg = history.find((m: any) => m.role === 'user' && typeof m.content === 'string' && /Agon detected repeated Read\/Grep\/Glob calls without new information/.test(m.content));
      expect(recoveryMsg).toBeDefined();
      // The new info-gain ladder text must NOT appear in strict mode.
      expect(history.some((m: any) => typeof m.content === 'string' && /\[info-gain\]/.test(m.content))).toBe(false);
      expect(chunks.some((c: any) => c.type === 'text' && /Done after recovery/.test(c.content))).toBe(true);
    } finally {
      if (prevTelemetry === undefined) delete process.env.AGON_GUARD_TELEMETRY;
      else process.env.AGON_GUARD_TELEMETRY = prevTelemetry;
    }
  });

  it('invariants: grounded-write feedback replaces the legacy solo-coding text on an uninvestigated edit', async () => {
    // The grounded-write guard blocks an Edit/Write to an EXISTING file the
    // engine has not read this session. Use a real repo file (package.json) so
    // fileExists() is true; net-new files would be allowed. The legacy gate's
    // complex-task heuristics are irrelevant here — grounded-write is purely
    // "did you read this exact existing file?".
    const home = setupTestAgonHome('guard-invariants-grounded');
    const prevTelemetry = process.env.AGON_GUARD_TELEMETRY;
    process.env.AGON_GUARD_TELEMETRY = '1';
    try {
      const { createResumeSession } = await import('../../packages/core/src/persistent-session.js');
      const existingFile = `${process.cwd()}/package.json`;
      // Step 1: Write the existing file WITHOUT reading it → grounded-write block.
      // Step 2: finish.
      apiStreamDispatchWithHistoryMock
        .mockImplementationOnce(() => streamWrite(existingFile, '{}'))
        .mockImplementationOnce(async function* () { yield 'Done.'; return {}; });

      const session = createResumeSession({
        engine: {
          id: 'api-invariants-gw',
          guards: 'invariants',
          api: { baseURL: 'https://example.invalid', apiKeyEnv: 'TEST_KEY', model: 'api-test' },
        } as any,
        binaryPath: '',
        cwd: process.cwd(),
        systemPrompt: 'You are Cesar.',
        nativeTools: [
          { type: 'function', function: { name: 'Write', description: 'w', parameters: { type: 'object', properties: {} } } },
        ] as any,
        onToolCall: async () => 'wrote',
        toolLoopBaseBudget: 4,
        toolLoopMaxBudget: 4,
      });

      await session.start();
      const chunks: any[] = [];
      for await (const chunk of session.send({
        message: 'update the version in package.json',
        toolLoopBaseBudget: 4,
        toolLoopMaxBudget: 4,
      })) {
        chunks.push(chunk);
      }

      const history = session.getMessageHistory();
      // The NEW grounded-write block text appears (the file path is embedded).
      const gwMsg = history.find((m: any) => m.role === 'tool' && typeof m.content === 'string' && m.content.startsWith('[BLOCKED: grounded-write]'));
      expect(gwMsg).toBeDefined();
      expect(String(gwMsg.content)).toContain('have not read it this session');
      // The legacy solo-coding gate text must NOT appear in invariants mode.
      expect(history.some((m: any) => typeof m.content === 'string' && /You haven't investigated the codebase yet/.test(m.content))).toBe(false);
      expect(chunks.some((c: any) => c.type === 'status' && /grounded-write/.test(c.content))).toBe(true);
    } finally {
      if (prevTelemetry === undefined) delete process.env.AGON_GUARD_TELEMETRY;
      else process.env.AGON_GUARD_TELEMETRY = prevTelemetry;
      cleanupTestAgonHome(home);
    }
  });
});
