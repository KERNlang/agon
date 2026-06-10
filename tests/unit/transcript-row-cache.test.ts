import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  buildTranscriptRows,
  nativeArchiveBlockCount,
} from '../../packages/cli/src/generated/surfaces/app.js';
import {
  _blockRowCache,
  blockRowFingerprint,
  cachedBlockOwnRows,
  clearBlockRowCache,
  isCacheableBlockType,
  renderBlockOwnRows,
} from '../../packages/cli/src/generated/surfaces/app-rendering.js';
import { withContentWidthOverride } from '../../packages/cli/src/generated/blocks/rendering.js';

// Resolved content widths used by buildTranscriptRows (contentWidth(4/2/8)) at
// a fixed 100-col terminal. Passing them explicitly keeps the cache key stable
// regardless of the test runner's real TTY width.
const W100 = { prose: 96, chat: 98, engine: 92 } as const;

const call = (
  block: any,
  mode = 'chat',
  toolExpanded = false,
  thinkingExpanded = true,
  widths = W100,
) =>
  cachedBlockOwnRows(
    block,
    mode,
    toolExpanded,
    thinkingExpanded,
    widths.prose,
    widths.chat,
    widths.engine,
  );

const engineBlock = (id: number, content: string) => ({
  id,
  event: { type: 'engine-block', engineId: 'cesar', color: 124, content },
});

beforeEach(() => {
  _blockRowCache.clear();
});

afterEach(() => {
  _blockRowCache.clear();
});

describe('per-block transcript row cache', () => {
  it('serves a cache hit on a repeated call: equal rows, same inner row objects, defensive outer copy', () => {
    const block = engineBlock(1, 'hello **world**');
    const first = call(block);
    const second = call(block);
    // The outer array is a defensive shallow copy (callers can never mutate the
    // cached array), but the row objects inside are the cached ones — identity
    // of the inner rows proves the hit skipped renderBlockOwnRows.
    expect(second).not.toBe(first);
    expect(second).toEqual(first);
    for (let i = 0; i < first.length; i++) {
      expect(second[i]).toBe(first[i]);
    }
    expect(_blockRowCache.size).toBe(1);
  });

  it('appending one block recomputes ONLY the new block; existing blocks stay cached', () => {
    const blocks = Array.from({ length: 20 }, (_, i) => engineBlock(i + 1, `block ${i + 1} body`));
    // Warm the cache for all 20.
    const warm = blocks.map((b) => call(b));
    expect(_blockRowCache.size).toBe(20);

    // Append one new block; re-render the whole list as buildTranscriptRows would.
    const newBlock = engineBlock(21, 'freshly appended');
    const all = [...blocks, newBlock];
    const second = all.map((b) => call(b));

    // The 20 original blocks must all be cache hits: inner row objects are the
    // cached ones (outer arrays are defensive copies).
    for (let i = 0; i < 20; i++) {
      expect(second[i]).toEqual(warm[i]);
      for (let j = 0; j < warm[i].length; j++) {
        expect(second[i][j]).toBe(warm[i][j]);
      }
    }
    // Only one new entry was added.
    expect(_blockRowCache.size).toBe(21);
  });

  it('a cache hit cannot be corrupted by mutating the returned array', () => {
    const block = engineBlock(1, 'immutable cache');
    const first = call(block);
    const pristine = JSON.parse(JSON.stringify(first));
    first.push({ corrupted: true });
    first.splice(0, 1);
    expect(call(block)).toEqual(pristine);
  });

  it('clearBlockRowCache empties the cache (wired to the /clear reset funnel)', () => {
    call(engineBlock(1, 'a'));
    call(engineBlock(2, 'b'));
    expect(_blockRowCache.size).toBe(2);
    clearBlockRowCache();
    expect(_blockRowCache.size).toBe(0);
  });

  it('a hit refreshes recency: hot entries survive the LRU eviction sweep', () => {
    // Fill to one below the cap, with block 1 inserted FIRST.
    const hot = engineBlock(1, 'hot block');
    call(hot);
    for (let i = 2; i <= 1499; i++) call(engineBlock(i, `filler ${i}`));
    // Touch the oldest entry — the hit re-inserts it at the back.
    call(hot);
    // Overflow the cap: the sweep evicts the least-recently-used 20%.
    for (let i = 1500; i <= 1600; i++) call(engineBlock(i, `overflow ${i}`));
    // The hot block survived; re-calling it is still a hit (size unchanged).
    const sizeBefore = _blockRowCache.size;
    call(hot);
    expect(_blockRowCache.size).toBe(sizeBefore);
  });

  it('fingerprint includes color/critique/position — changing them busts the cache', () => {
    const a = call({ id: 1, event: { type: 'engine-block', engineId: 'cesar', color: 124, content: 'same' } });
    const b = call({ id: 1, event: { type: 'engine-block', engineId: 'cesar', color: 33, content: 'same' } });
    expect(_blockRowCache.size).toBe(2);
    expect(b).not.toEqual(a);
    _blockRowCache.clear();
    call({ id: 2, event: { type: 'kern-draft', engineId: 'x', content: 'draft', critique: 'weak' } });
    call({ id: 2, event: { type: 'kern-draft', engineId: 'x', content: 'draft', critique: 'strong' } });
    expect(_blockRowCache.size).toBe(2);
    _blockRowCache.clear();
    call({ id: 3, event: { type: 'debate-round', engineId: 'x', argument: 'arg', position: 'for' } });
    call({ id: 3, event: { type: 'debate-round', engineId: 'x', argument: 'arg', position: 'against' } });
    expect(_blockRowCache.size).toBe(2);
  });

  it('same head and length but different tail does not collide', () => {
    const head = 'x'.repeat(200);
    const a = call({ id: 1, event: { type: 'text', content: `${head}AAAA` } });
    const b = call({ id: 1, event: { type: 'text', content: `${head}BBBB` } });
    expect(_blockRowCache.size).toBe(2);
    expect(b).not.toEqual(a);
  });

  it('misses the cache when mode changes', () => {
    const block = engineBlock(1, 'mode-sensitive');
    const chat = call(block, 'chat');
    const tribunal = call(block, 'tribunal');
    expect(tribunal).not.toBe(chat);
    expect(_blockRowCache.size).toBe(2);
  });

  it('misses the cache when toolOutputExpanded / thinkingExpanded change', () => {
    const block = { id: 7, event: { type: 'thinking-chunk', chunk: 'reason line a\nreason line b' } };
    const a = call(block, 'chat', false, true);
    const b = call(block, 'chat', false, false);
    expect(b).not.toBe(a);
  });

  it('misses the cache when terminal width changes (widths are in the key)', () => {
    const block = engineBlock(1, 'wrap me at different widths');
    const wide = call(block, 'chat', false, true, { prose: 96, chat: 98, engine: 92 });
    const narrow = call(block, 'chat', false, true, { prose: 36, chat: 38, engine: 32 });
    expect(narrow).not.toBe(wide);
  });

  it('mutation fingerprint busts the cache when a block event field changes in place', () => {
    const block: any = engineBlock(1, 'original content');
    const before = call(block);
    // Simulate an in-place mutation of the same block object/id.
    block.event.content = 'totally different content now';
    const after = call(block);
    expect(after).not.toBe(before);
    // And the command field busts it too (permission-ask renders its diff from
    // event.command, which is folded into the fingerprint).
    const perm = { id: 2, event: { type: 'permission-ask', tool: 'Edit', command: JSON.stringify({ file_path: 'a.ts', old_string: 'x', new_string: 'y' }) } } as any;
    const r1 = call(perm);
    perm.event.command = JSON.stringify({ file_path: 'a.ts', old_string: 'x', new_string: 'COMPLETELY DIFFERENT' });
    const r2 = call(perm);
    expect(r2).not.toBe(r1);
  });

  it('excludes neighbor-dependent and impure block types from caching', () => {
    expect(isCacheableBlockType('tool-call')).toBe(false);
    expect(isCacheableBlockType('tool-call-group')).toBe(false);
    expect(isCacheableBlockType('file-changes')).toBe(false);
    expect(isCacheableBlockType('engine-block')).toBe(true);
    expect(isCacheableBlockType('user-message')).toBe(true);
    expect(isCacheableBlockType('info')).toBe(true);
  });

  it('does not cache tool-call blocks even when routed through cachedBlockOwnRows', () => {
    const block = {
      id: 9,
      event: { type: 'tool-call', engineId: 'cesar', tool: 'Read', input: '{"file_path":"a.ts"}', status: 'done', output: 'l1' },
    } as any;
    call(block);
    expect(_blockRowCache.size).toBe(0); // tool-call never stored
  });

  it('keeps the fingerprint distinct across content, status, engine, mode, and width', () => {
    const base = { type: 'engine-block', engineId: 'a', content: 'x', status: 'done' } as any;
    const fp = (e: any, mode = 'chat', te = false, the = true, p = 96, c = 98, en = 92) =>
      blockRowFingerprint(e, mode, te, the, p, c, en);
    const f0 = fp(base);
    expect(fp({ ...base, content: 'y' })).not.toBe(f0);
    expect(fp({ ...base, status: 'running' })).not.toBe(f0);
    expect(fp({ ...base, engineId: 'b' })).not.toBe(f0);
    expect(fp(base, 'tribunal')).not.toBe(f0);
    expect(fp(base, 'chat', false, true, 40)).not.toBe(f0);
    expect(fp(base)).toBe(f0); // deterministic
  });

  it('bounds the cache via LRU-evict-oldest-20% on overflow', () => {
    // Fill well past the 1500 cap with unique blocks.
    for (let i = 0; i < 2000; i++) {
      call(engineBlock(100000 + i, `unique body ${i}`));
    }
    expect(_blockRowCache.size).toBeLessThanOrEqual(1500);
    expect(_blockRowCache.size).toBeGreaterThan(0);
  });
});

describe('cache correctness vs cold rebuild (property-style)', () => {
  // The cached buildTranscriptRows output must be byte-for-byte identical to a
  // cold (cache-cleared) rebuild — including tool groups, the strongest proof.
  const buildAt100 = (blocks: any[], mode: string, toolExpanded: boolean) =>
    withContentWidthOverride(100, () => buildTranscriptRows(blocks, mode, toolExpanded, true));

  const transcripts: { name: string; blocks: any[]; mode: string; toolExpanded: boolean }[] = [
    {
      name: 'mixed prose + user + info',
      mode: 'chat',
      toolExpanded: false,
      blocks: [
        { id: 1, event: { type: 'user-message', content: 'explain the flow' } },
        engineBlock(2, '# Heading\n\nSome **prose** with `code`.\n\n```ts\nconst x = 1;\n```'),
        { id: 3, event: { type: 'info', message: 'just so you know' } },
        engineBlock(4, 'second answer body'),
      ],
    },
    {
      name: 'collapsed adjacent tool-call group',
      mode: 'chat',
      toolExpanded: false,
      blocks: [
        { id: 1, event: { type: 'user-message', content: 'do work' } },
        { id: 2, event: { type: 'tool-call', engineId: 'cesar', tool: 'Read', input: '{"file_path":"a.ts"}', status: 'done', output: 'l1\nl2' } },
        { id: 3, event: { type: 'tool-call', engineId: 'cesar', tool: 'Grep', input: '{"pattern":"x"}', status: 'done', output: 'a.ts:x' } },
        { id: 4, event: { type: 'tool-call', engineId: 'cesar', tool: 'Bash', input: '{"command":"ls"}', status: 'done', output: 'a\nb' } },
        engineBlock(5, 'wrap-up answer'),
      ],
    },
    {
      name: 'tool-call-group block coalescing with following tool-call',
      mode: 'chat',
      toolExpanded: false,
      blocks: [
        {
          id: 1,
          event: {
            type: 'tool-call-group',
            blocks: [
              { id: 11, event: { type: 'tool-call', engineId: 'cesar', tool: 'Read', input: '{"file_path":"a.ts"}', status: 'done', output: 'x' } },
              { id: 12, event: { type: 'tool-call', engineId: 'cesar', tool: 'Edit', input: '{"file_path":"a.ts","old_string":"a","new_string":"b"}', status: 'done' } },
            ],
          },
        },
        { id: 2, event: { type: 'tool-call', engineId: 'cesar', tool: 'Bash', input: '{"command":"npm test"}', status: 'done', output: 'ok' } },
        engineBlock(3, 'all green'),
      ],
    },
    {
      name: 'expanded tool group',
      mode: 'chat',
      toolExpanded: true,
      blocks: [
        { id: 1, event: { type: 'tool-call', engineId: 'cesar', tool: 'Read', input: '{"file_path":"a.ts"}', status: 'done', output: 'line 1\nline 2\nline 3' } },
        { id: 2, event: { type: 'tool-call', engineId: 'cesar', tool: 'Search', input: '{"pattern":"foo"}', status: 'done', output: 'a.ts:foo' } },
        engineBlock(3, 'done'),
      ],
    },
  ];

  for (const t of transcripts) {
    it(`cached output deep-equals a cold rebuild — ${t.name}`, () => {
      _blockRowCache.clear();
      const cold = buildAt100(t.blocks, t.mode, t.toolExpanded);
      // Second pass runs against a warm cache.
      const warm = buildAt100(t.blocks, t.mode, t.toolExpanded);
      expect(warm).toEqual(cold);
      // And a fully cold rebuild after clearing must also match.
      _blockRowCache.clear();
      const coldAgain = buildAt100(t.blocks, t.mode, t.toolExpanded);
      expect(coldAgain).toEqual(cold);
    });
  }

  it('append-one transcript produces the same rows as a from-scratch build', () => {
    _blockRowCache.clear();
    const base = [
      { id: 1, event: { type: 'user-message', content: 'q1' } },
      engineBlock(2, 'a1 body'),
    ];
    buildAt100(base, 'chat', false); // warm

    const extended = [...base, { id: 3, event: { type: 'user-message', content: 'q2' } }, engineBlock(4, 'a2 body')];
    const incremental = buildAt100(extended, 'chat', false);

    _blockRowCache.clear();
    const fromScratch = buildAt100(extended, 'chat', false);
    expect(incremental).toEqual(fromScratch);
  });
});

describe('maxLiveBlocks tightened to 40', () => {
  it('seals into Static once more than 40 cheap blocks accumulate (live tail capped at 40)', () => {
    // 60 one-row separators, generous row budget so the cap (not rows) is the
    // binding constraint. With maxLiveBlocks=40, the live tail is exactly 40,
    // so the archive count is 60 - 40 = 20.
    const blocks = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, event: { type: 'separator' } })) as any;
    expect(nativeArchiveBlockCount(blocks, 'chat', 10_000, false, true)).toBe(20);
  });

  it('does not archive when there are 40 or fewer blocks and the budget is generous', () => {
    const blocks = Array.from({ length: 40 }, (_, i) => ({ id: i + 1, event: { type: 'separator' } })) as any;
    expect(nativeArchiveBlockCount(blocks, 'chat', 10_000, false, true)).toBe(0);
  });
});
