import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assignStances, collectRankedDrafts, runBrainstorm } from '../../packages/forge/src/generated/brainstorm.js';

const STANCE_LABELS = ['ANCHOR', 'CONTRARIAN', 'FIRST-PRINCIPLES', 'OUTSIDER', 'EXPANSIONIST', 'WILDCARD'];

const DRAFT_BLOCK = `draft {
  approach: "use a message queue to decouple the pipeline"
  reasoning: "reduces coupling between stages"
  tradeoffs: "latency", "ops burden"
  confidence: 70
  keyFiles: "src/a.ts"
  steps {
    1: "one"
    2: "two"
    3: "three"
  }
}`;

function makeFakes() {
  const calls: { engineId: string; prompt: string; systemPrompt?: string; textOnly?: boolean }[] = [];
  const adapter = {
    dispatch: async (o: any) => {
      calls.push({ engineId: o.engine?.id, prompt: o.prompt, systemPrompt: o.systemPrompt, textOnly: o.textOnly });
      return { exitCode: 0, stdout: DRAFT_BLOCK, stderr: '', timedOut: false };
    },
  } as any;
  const registry = {
    get: (id: string) => ({ id, binary: id }),
    list: () => [],
    findBinary: () => null,
  } as any;
  return { calls, adapter, registry };
}

const SIX_ENGINES = ['e1', 'e2', 'e3', 'e4', 'e5', 'e6'];

function baseOpts(overrides: Record<string, unknown> = {}) {
  const { calls, adapter, registry } = makeFakes();
  return {
    calls,
    opts: {
      question: 'how should we cache?',
      engines: SIX_ENGINES,
      registry,
      adapter,
      timeout: 5,
      outputDir: mkdtempSync(join(tmpdir(), 'agon-brainstorm-style-')),
      ...overrides,
    },
  };
}

describe('brainstorm divergent style', () => {
  describe('assignStances', () => {
    it('gives every engine exactly one stance from the known set', () => {
      const map = assignStances(SIX_ENGINES);
      expect(map.size).toBe(6);
      for (const id of SIX_ENGINES) {
        const stance = map.get(id)!;
        expect(STANCE_LABELS.some((label) => stance.startsWith(`${label}:`))).toBe(true);
      }
    });

    it('uses all six distinct stances for a six-engine panel', () => {
      const map = assignStances(SIX_ENGINES);
      expect(new Set(map.values()).size).toBe(6);
    });

    it('cycles stances when the panel is larger than the stance pool', () => {
      const engines = [...SIX_ENGINES, 'e7', 'e8'];
      const map = assignStances(engines);
      expect(map.size).toBe(8);
      for (const id of engines) expect(map.get(id)).toBeTruthy();
    });
  });

  describe('collectRankedDrafts stance injection', () => {
    it('divergent style: each seat gets a distinct stance in the system prompt, user prompt stays identical and stance-free', async () => {
      const { calls, opts } = baseOpts({ style: 'divergent' });
      await collectRankedDrafts(opts as any);
      expect(calls.length).toBe(6);
      const stanceLines = calls.map((c) => c.systemPrompt ?? '');
      for (const sp of stanceLines) {
        expect(sp).toContain('Your seat stance —');
        expect(sp).toContain('one hypothesis about the underlying problem');
        expect(sp).toContain('Do not add any text outside the draft block');
      }
      expect(new Set(stanceLines).size).toBe(6);
      // Protocol draft prompt must stay byte-identical across seats — the
      // stance rides ONLY in the system prompt.
      expect(new Set(calls.map((c) => c.prompt)).size).toBe(1);
      expect(calls[0].prompt).not.toContain('seat stance');
    });

    it('grounded/absent style: system prompt is the plain brainstorm instruction with no stance', async () => {
      const { calls, opts } = baseOpts();
      await collectRankedDrafts(opts as any);
      expect(calls.length).toBe(6);
      for (const c of calls) {
        expect(c.systemPrompt).not.toContain('seat stance');
        expect(c.systemPrompt).toContain('You are participating in a brainstorm');
      }
    });
  });

  describe('runBrainstorm style dispatch + synthesis prompt', () => {
    async function synthesisPromptFor(style?: string) {
      const { calls, opts } = baseOpts(style ? { style } : {});
      await runBrainstorm(opts as any);
      const synthesis = calls.filter((c) => c.prompt.includes('Multiple AI engines analyzed'));
      expect(synthesis.length).toBe(1);
      return synthesis[0].prompt;
    }

    it('defaults to divergent: synthesis keeps distinct directions and one closing recommendation', async () => {
      const prompt = await synthesisPromptFor();
      expect(prompt).toContain('deliberately different stances');
      expect(prompt).toContain('DISTINCT directions');
      expect(prompt).toContain('challenges the framing');
      expect(prompt).toContain('single clear recommendation');
      expect(prompt).not.toContain('Include file paths where relevant');
    });

    it('grounded style restores the convergent synthesis prompt', async () => {
      const prompt = await synthesisPromptFor('grounded');
      expect(prompt).toContain('synthesize the best parts from each into one comprehensive answer');
      expect(prompt).toContain('Be specific and actionable. Include file paths where relevant.');
      expect(prompt).not.toContain('DISTINCT directions');
    });

    it('marks every seat and the synthesis dispatch textOnly so engines cannot burn the turn on tools', async () => {
      const { calls, opts } = baseOpts();
      await runBrainstorm(opts as any);
      expect(calls.length).toBeGreaterThan(0);
      for (const c of calls) expect(c.textOnly).toBe(true);
    });
  });
});
