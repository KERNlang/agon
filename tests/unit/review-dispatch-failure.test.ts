import { describe, it, expect } from 'vitest';
import { runReviewCore } from '../../packages/cli/src/generated/handlers/review.js';

// Regression for the double-swallowed-error bug: a stalled SSE stream used to
// come back from dispatch.kern as a silent success (exitCode 0, stderr ''),
// and runReviewCore only ever read `.usage`/`.stdout` off the final
// DispatchResult — so a genuine dispatch failure (idle timeout, stream error)
// with no accumulated text was indistinguishable from a real empty answer and
// got misreported downstream as "parse-failure: empty or unusable response".
// runReviewCore must now capture the FULL final DispatchResult and THROW the
// real failure when the response is empty and the dispatch signals failure
// (nonzero exitCode / timedOut / non-empty stderr) — leaving genuine
// parse-failures (a clean exit with unparseable text) alone.

const VALID_FINDINGS = '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```';
const diff = 'diff --git a/foo.ts b/foo.ts\n@@ -0,0 +1 @@\n+foo';

function fakeCtxBase() {
  return {
    config: { reviewFileContext: false },
    registry: { get: () => ({ id: 'fake', name: 'fake' }) },
  };
}

// Streaming adapter path: dispatchStream is present, so runReviewCore drains
// the async generator and reads the final DispatchResult off `iter.value`
// when `iter.done`.
function fakeCtxStream(finalResult: unknown, chunks: string[] = []) {
  return {
    ...fakeCtxBase(),
    adapter: {
      dispatchStream: (_opts: unknown) => (async function* () {
        for (const c of chunks) yield c;
        return finalResult;
      })(),
    },
  } as any;
}

// Non-streaming adapter path: no dispatchStream, so runReviewCore falls back
// to `await ctx.adapter.dispatch(...)` and reads the DispatchResult directly.
function fakeCtxNonStreaming(result: unknown) {
  return {
    ...fakeCtxBase(),
    adapter: {
      dispatch: async (_opts: unknown) => result,
    },
  } as any;
}

describe('runReviewCore surfaces real dispatch failures (Fix B)', () => {
  it('throws with the real stderr when the STREAMING dispatch returns no text + a failed result', async () => {
    const ctx = fakeCtxStream({
      exitCode: 124,
      stdout: '',
      stderr: 'API stream inter-chunk idle timeout after 90s (received 2 chunks, 0 text chars)',
      timedOut: true,
    });
    await expect(runReviewCore(diff, 'label', 'fake', ctx)).rejects.toThrow(
      'API stream inter-chunk idle timeout after 90s (received 2 chunks, 0 text chars)',
    );
  });

  it('throws with the real stderr when the NON-STREAMING dispatch returns no text + a failed result', async () => {
    const ctx = fakeCtxNonStreaming({
      exitCode: 124,
      stdout: '',
      stderr: 'API stream first-chunk idle timeout after 60s (received 0 chunks, 0 text chars)',
      timedOut: true,
    });
    await expect(runReviewCore(diff, 'label', 'fake', ctx)).rejects.toThrow(
      'API stream first-chunk idle timeout after 60s (received 0 chunks, 0 text chars)',
    );
  });

  it('falls back to a generic exit-code message when the failed result carries no stderr', async () => {
    const ctx = fakeCtxNonStreaming({ exitCode: 1, stdout: '', stderr: '', timedOut: false });
    await expect(runReviewCore(diff, 'label', 'fake', ctx)).rejects.toThrow('exit 1');
  });

  it('does NOT throw when the response is non-empty, even if exitCode is nonzero (a partial review is still useful)', async () => {
    const ctx = fakeCtxNonStreaming({
      exitCode: 1,
      stdout: `Some partial prose review.\n${VALID_FINDINGS}`,
      stderr: 'late-stage error after partial output',
      timedOut: false,
    });
    const result = await runReviewCore(diff, 'label', 'fake', ctx);
    expect(result.response).toContain('Some partial prose review.');
    expect(result.parseFailed).toBe(false);
  });

  it('normal success path is unaffected: exit 0 + parseable findings never throws', async () => {
    const ctx = fakeCtxNonStreaming({
      exitCode: 0,
      stdout: `Looks fine.\n${VALID_FINDINGS}`,
      stderr: '',
      timedOut: false,
    });
    const result = await runReviewCore(diff, 'label', 'fake', ctx);
    expect(result.parseFailed).toBe(false);
    expect(result.blocking).toBe(false);
  });

  it('a genuine parse-failure (clean exit, unparseable short text) still reports parseFailed instead of throwing', async () => {
    const ctx = fakeCtxNonStreaming({
      exitCode: 0,
      stdout: 'ok',
      stderr: '',
      timedOut: false,
    });
    const result = await runReviewCore(diff, 'label', 'fake', ctx);
    expect(result.parseFailed).toBe(true);
  });
});

// --- Fix C(b): reasoning exhaustion is named, not misreported as parse-failure ---
// A reasoning model on a huge review prompt can exhaust its ENTIRE output-token
// budget thinking: the stream then finishes CLEANLY (exit 0, no stderr) with
// zero text and finishReason 'length'. Fix B's failure check doesn't fire
// (nothing failed), so without this check the empty answer would fall through
// to "parse-failure: empty or unusable response" again.
describe('runReviewCore names reasoning exhaustion (Fix C)', () => {
  it('throws the reasoning-exhaustion message on a clean empty result with finishReason=length + reasoning-only parts', async () => {
    const ctx = fakeCtxNonStreaming({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      finishReason: 'length',
      parts: [{ kind: 'reasoning', text: 'x'.repeat(500) }],
    });
    await expect(runReviewCore(diff, 'label', 'fake', ctx)).rejects.toThrow(
      'model exhausted its output budget on reasoning (finishReason=length, ~500 reasoning chars, 0 text chars) — raise reviewMaxTokens or reduce prompt size',
    );
  });

  it('throws on finishReason=length even when no structured parts were captured', async () => {
    const ctx = fakeCtxNonStreaming({
      exitCode: 0, stdout: '', stderr: '', timedOut: false, finishReason: 'length',
    });
    await expect(runReviewCore(diff, 'label', 'fake', ctx)).rejects.toThrow(
      /model exhausted its output budget on reasoning \(finishReason=length, ~0 reasoning chars, 0 text chars\)/,
    );
  });

  it('throws on reasoning-only parts with zero text parts even without a finishReason', async () => {
    const ctx = fakeCtxStream({
      exitCode: 0,
      stdout: '',
      stderr: '',
      timedOut: false,
      parts: [{ kind: 'reasoning', text: 'pondering' }],
    });
    await expect(runReviewCore(diff, 'label', 'fake', ctx)).rejects.toThrow(
      /model exhausted its output budget on reasoning \(finishReason=unknown, ~9 reasoning chars, 0 text chars\)/,
    );
  });

  it('does NOT throw when reasoning parts coexist with real text output', async () => {
    const ctx = fakeCtxNonStreaming({
      exitCode: 0,
      stdout: `Real review prose here.\n${VALID_FINDINGS}`,
      stderr: '',
      timedOut: false,
      finishReason: 'stop',
      parts: [
        { kind: 'reasoning', text: 'thinking' },
        { kind: 'text', text: 'Real review prose here.' },
      ],
    });
    const result = await runReviewCore(diff, 'label', 'fake', ctx);
    expect(result.parseFailed).toBe(false);
  });
});

// --- Fix E: strip chrome/reasoning BEFORE the failure checks ---
// A failed dispatch whose only output is <think> scaffolding (or TUI spinner
// chrome) is non-empty raw but empty once stripped. The failure check must run
// on the STRIPPED response — otherwise it skips the throw and the now-empty
// response falls back into the generic parse-failure misdiagnosis.
describe('runReviewCore strips scaffolding before the failure check (Fix E)', () => {
  it('throws the real stderr when a failed dispatch produced only <think> scaffolding', async () => {
    const ctx = fakeCtxNonStreaming({
      exitCode: 124,
      stdout: '<think>ruminations</think>',
      stderr: 'API stream inter-chunk idle timeout after 90s (received 4 chunks, 0 text chars)',
      timedOut: true,
    });
    await expect(runReviewCore(diff, 'label', 'fake', ctx)).rejects.toThrow(
      'API stream inter-chunk idle timeout after 90s (received 4 chunks, 0 text chars)',
    );
  });

  it('throws reasoning-exhaustion when a clean length-capped dispatch leaked only <think> text into stdout', async () => {
    const ctx = fakeCtxNonStreaming({
      exitCode: 0,
      stdout: '<think>leaked scaffolding</think>',
      stderr: '',
      timedOut: false,
      finishReason: 'length',
      parts: [{ kind: 'reasoning', text: 'leaked scaffolding' }],
    });
    await expect(runReviewCore(diff, 'label', 'fake', ctx)).rejects.toThrow(
      /model exhausted its output budget on reasoning/,
    );
  });
});

// --- Fix D: review must not cap engines below their own configured budget ---
// The dispatch layer spreads options.maxTokens OVER engine.api.maxTokens, so
// review's old flat `reviewMaxTokens ?? 8192` silently squeezed reasoning
// engines (kimi/zai configure api.maxTokens 16384) down to 8192 — the direct
// cause of the reasoning-exhaustion failures above.
describe('runReviewCore maxTokens resolution (Fix D)', () => {
  function ctxRecordingMaxTokens(record: { maxTokens?: number }, engine: any, config: any = {}) {
    return {
      config: { reviewFileContext: false, ...config },
      registry: { get: () => engine },
      adapter: {
        dispatch: async (opts: { maxTokens?: number }) => {
          record.maxTokens = opts.maxTokens;
          return { stdout: `fine\n${VALID_FINDINGS}`, exitCode: 0, stderr: '', timedOut: false };
        },
      },
    } as any;
  }

  it('uses the engine\'s own api.maxTokens when it exceeds the 8192 default and no reviewMaxTokens is configured', async () => {
    const record: { maxTokens?: number } = {};
    const engine = { id: 'kimi', api: { baseUrl: 'http://x', apiKeyEnv: 'K', model: 'm', maxTokens: 16384 } };
    await runReviewCore(diff, 'label', 'kimi', ctxRecordingMaxTokens(record, engine));
    expect(record.maxTokens).toBe(16384);
  });

  it('explicit config.reviewMaxTokens always wins, even below the engine cap', async () => {
    const record: { maxTokens?: number } = {};
    const engine = { id: 'kimi', api: { baseUrl: 'http://x', apiKeyEnv: 'K', model: 'm', maxTokens: 16384 } };
    await runReviewCore(diff, 'label', 'kimi', ctxRecordingMaxTokens(record, engine, { reviewMaxTokens: 4096 }));
    expect(record.maxTokens).toBe(4096);
  });

  it('falls back to the 8192 default for an engine without an api block', async () => {
    const record: { maxTokens?: number } = {};
    const engine = { id: 'cli-only', binary: 'cli-only' };
    await runReviewCore(diff, 'label', 'cli-only', ctxRecordingMaxTokens(record, engine));
    expect(record.maxTokens).toBe(8192);
  });

  it('keeps the 8192 floor for an api engine whose own cap is lower', async () => {
    const record: { maxTokens?: number } = {};
    const engine = { id: 'small', api: { baseUrl: 'http://x', apiKeyEnv: 'K', model: 'm', maxTokens: 4096 } };
    await runReviewCore(diff, 'label', 'small', ctxRecordingMaxTokens(record, engine));
    expect(record.maxTokens).toBe(8192);
  });
});
