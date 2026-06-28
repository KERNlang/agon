import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleReviewMany } from '../../packages/cli/src/generated/handlers/review.js';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

const VALID_FINDINGS = '<!--AGON_REVIEW_FINDINGS_v1-->\n```json\n[]\n```';

let repo: string | undefined;
let oldCwd: string | undefined;
let agonHome: string | undefined;

afterEach(() => {
  if (oldCwd) process.chdir(oldCwd);
  oldCwd = undefined;
  if (repo) rmSync(repo, { recursive: true, force: true });
  repo = undefined;
  cleanupTestAgonHome(agonHome);
  agonHome = undefined;
});

function setupRepo(): string {
  const d = mkdtempSync(join(tmpdir(), 'agon-review-timeout-'));
  writeFileSync(join(d, 'file.ts'), 'export const value = 1;\n');
  execFileSync('git', ['init'], { cwd: d, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'agon-test@example.test'], { cwd: d, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.name', 'Agon Test'], { cwd: d, stdio: 'ignore' });
  execFileSync('git', ['add', 'file.ts'], { cwd: d, stdio: 'ignore' });
  execFileSync('git', ['commit', '-m', 'base'], { cwd: d, stdio: 'ignore' });
  writeFileSync(join(d, 'file.ts'), 'export const value = 2;\n');
  return d;
}

function makeCtx() {
  const dispatchCalls: string[] = [];
  const ctx: any = {
    config: { reviewFileContext: false, reviewTimeout: 0.05 },
    registry: {
      resolveId: (id: string) => id,
      get: (id: string) => ({ id, displayName: id, review: { args: [] } }),
    },
    adapter: {
      dispatch: async (opts: { engine: { id: string } }) => {
        dispatchCalls.push(opts.engine.id);
        if (opts.engine.id === 'hung') {
          return new Promise(() => undefined);
        }
        return {
          stdout: `looks good\n${VALID_FINDINGS}`,
          exitCode: 0,
          usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15, source: 'cli-reported' },
        };
      },
    },
    chatSession: {
      id: 'review-many-timeout',
      startedAt: new Date().toISOString(),
      messages: [],
    },
    setActiveAbort: () => undefined,
  };
  return { ctx, dispatchCalls };
}

function initChatFile(agonHomeDir: string, chatSession: { id: string; startedAt: string }): void {
  const chatsDir = join(agonHomeDir, 'chats');
  mkdirSync(chatsDir, { recursive: true });
  writeFileSync(join(chatsDir, `${chatSession.id}.ndjson`), JSON.stringify({
    id: chatSession.id,
    startedAt: chatSession.startedAt,
    messages: [],
  }) + '\n');
}

describe('handleReviewMany hard timeout', () => {
  it('returns a timeout result when one review engine ignores AbortSignal forever', async () => {
    agonHome = setupTestAgonHome('review-many-timeout');
    repo = setupRepo();
    oldCwd = process.cwd();
    process.chdir(repo);

    const events: Array<{ type: string; message?: string }> = [];
    const { ctx, dispatchCalls } = makeCtx();
    initChatFile(agonHome, ctx.chatSession);
    const started = Date.now();
    await handleReviewMany((event: any) => events.push(event), ctx, 'uncommitted', ['ok', 'hung']);
    const elapsed = Date.now() - started;

    expect(dispatchCalls.sort()).toEqual(['hung', 'ok']);
    expect(elapsed).toBeLessThan(1000);
    expect(events.some((e) => e.type === 'warning' && e.message?.includes('hung: timed out after 0.05s'))).toBe(true);
    expect(events.some((e) => e.message?.includes('Multi-review complete (ok)'))).toBe(true);
    expect(ctx.lastReviewResult.engineId).toBe('ok');
  });
});
