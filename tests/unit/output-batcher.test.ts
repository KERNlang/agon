import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLatestUiCommitter, createTranscriptCommitBatcher } from '../../packages/cli/src/generated/surfaces/app-output-bridge.js';

describe('transcript frame commit batcher', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('applies ordered mutations in one commit per frame', () => {
    vi.useFakeTimers();
    let blocks: any[] = [];
    let commits = 0;
    const batcher = createTranscriptCommitBatcher((updater: any) => {
      commits += 1;
      blocks = typeof updater === 'function' ? updater(blocks) : updater;
    }, 16);

    batcher.enqueue((prev: any[]) => [...prev, { id: 1 }]);
    batcher.enqueue((prev: any[]) => [...prev, { id: 2 }]);
    batcher.enqueue((prev: any[]) => prev.map((block) => block.id === 2 ? { ...block, done: true } : block));

    expect(commits).toBe(0);
    expect(batcher.pendingCount()).toBe(3);
    vi.advanceTimersByTime(15);
    expect(commits).toBe(0);
    vi.advanceTimersByTime(1);

    expect(commits).toBe(1);
    expect(blocks).toEqual([{ id: 1 }, { id: 2, done: true }]);
    expect(batcher.pendingCount()).toBe(0);
  });

  it('flushes semantic boundaries immediately and discards stale reset work', () => {
    vi.useFakeTimers();
    let blocks: any[] = [];
    let commits = 0;
    const batcher = createTranscriptCommitBatcher((updater: any) => {
      commits += 1;
      blocks = typeof updater === 'function' ? updater(blocks) : updater;
    }, 16);

    batcher.enqueue((prev: any[]) => [...prev, { id: 'answer' }]);
    batcher.flush();
    expect(commits).toBe(1);
    expect(blocks).toEqual([{ id: 'answer' }]);

    batcher.enqueue((prev: any[]) => [...prev, { id: 'stale-before-clear' }]);
    batcher.discard();
    vi.runAllTimers();
    expect(commits).toBe(1);
    expect(blocks).toEqual([{ id: 'answer' }]);
  });

  it('cancels a pending preview frame when a semantic boundary clears now', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-15T10:00:00Z'));
    const commits: string[] = [];
    const committer = createLatestUiCommitter((value: string) => commits.push(value), 66);

    committer.enqueue('frame-1');
    vi.advanceTimersByTime(10);
    committer.enqueue('stale-frame-2');
    expect(committer.hasPending()).toBe(true);

    committer.commitNow('cleared');
    expect(commits).toEqual(['frame-1', 'cleared']);
    expect(committer.hasPending()).toBe(false);
    vi.runAllTimers();
    expect(commits).toEqual(['frame-1', 'cleared']);
  });

  it('generates stable mount-only React effects instead of nested dependency arrays', () => {
    const generated = readFileSync(new URL('../../packages/cli/src/generated/surfaces/app.tsx', import.meta.url), 'utf8');
    expect(generated).not.toContain('}, [[]]);');
    expect(generated).toContain('if (uiInteractionTimerRef.current) clearTimeout(uiInteractionTimerRef.current);');
  });

  it('threads the visible persistent AUTO state into Cesar task contexts', () => {
    const generated = readFileSync(new URL('../../packages/cli/src/generated/surfaces/app.tsx', import.meta.url), 'utf8');
    const start = generated.indexOf('const buildContext = useCallback');
    const end = generated.indexOf('\n\n  const ', start + 1);
    const buildContext = generated.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(buildContext).toContain('autoModeQueued,');
    expect(buildContext).toContain('}, [registry,adapter,activeEngines,chatSession,askQuestion,cesarSession,explorationMode,neroMode,extensionPromptFragments,sessionMcpServers,autoModeQueued,');
  });

  it('keeps plan approval controls visible before long plan bodies', () => {
    const generated = readFileSync(new URL('../../packages/cli/src/generated/blocks/plan-view.tsx', import.meta.url), 'utf8');
    const markdownBranch = generated.slice(generated.indexOf('if (markdown && markdown.trim())'), generated.indexOf('// ── Steps ──'));

    expect(markdownBranch.indexOf('{approvalControls}')).toBeGreaterThan(-1);
    expect(markdownBranch.indexOf('{approvalControls}')).toBeLessThan(markdownBranch.indexOf('<RenderedSegments'));
    expect(generated).toContain('/approve run · /cancel reject');
  });
});
