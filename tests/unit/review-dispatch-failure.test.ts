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
