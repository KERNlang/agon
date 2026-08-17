import { describe, expect, it } from 'vitest';
import {
  canonicalStepSignature,
  classifyToolEffect,
  isReadRepeat,
  normalizeStepSignature,
  normalizeStepToolName,
  primaryStepInput,
  stepEarnsBudgetGrowth,
} from '../../packages/core/src/generated/sessions/step-effect.js';
import type { ToolStepEffectEntry } from '../../packages/core/src/generated/sessions/step-effect.js';

// Loose matchers exactly as discoverGate produces them for this repo.
const GATE_MATCHERS = ['npm run test', 'test', 'npm test', 'vitest', 'npm run typecheck', 'typecheck', 'tsc'];

describe('classifyToolEffect', () => {
  it('classifies shell-mediated reading as read', () => {
    expect(classifyToolEffect('Bash', 'cat foo.py')).toBe('read');
    expect(classifyToolEffect('Bash', 'grep -rn handleSubmit packages/')).toBe('read');
    expect(classifyToolEffect('Bash', 'ls packages/cli/src')).toBe('read');
    expect(classifyToolEffect('Bash', 'git status')).toBe('read');
  });

  it('classifies a gate-matching Bash command as verify even though it is read-only', () => {
    expect(classifyToolEffect('Bash', 'npm test', GATE_MATCHERS)).toBe('verify');
    expect(classifyToolEffect('Bash', 'npm run typecheck', GATE_MATCHERS)).toBe('verify');
    expect(classifyToolEffect('Bash', 'npx vitest run tests/unit/x.test.ts', GATE_MATCHERS)).toBe('verify');
    // No gate known → cannot be recognized as verification; falls back to read.
    expect(classifyToolEffect('Bash', 'npm test')).toBe('read');
  });

  it('classifies unclassifiable Bash wrappers as other (neutral)', () => {
    expect(classifyToolEffect('Bash', 'python -c "print(open(\'x.py\').read())"', GATE_MATCHERS)).toBe('other');
    expect(classifyToolEffect('Bash', 'rm -rf /tmp/scratch', GATE_MATCHERS)).toBe('other');
    expect(classifyToolEffect('Bash', '   ', GATE_MATCHERS)).toBe('other');
  });

  it('classifies read tools, write tools and everything else', () => {
    expect(classifyToolEffect('Read', 'packages/cli/src/app.tsx')).toBe('read');
    expect(classifyToolEffect('Grep', 'handleSubmit packages/')).toBe('read');
    expect(classifyToolEffect('Glob', '**/*.kern')).toBe('read');
    expect(classifyToolEffect('Edit', 'packages/cli/src/app.tsx')).toBe('mutate');
    expect(classifyToolEffect('Write', 'x.ts')).toBe('mutate');
    expect(classifyToolEffect('MultiEdit', 'x.ts')).toBe('mutate');
    expect(classifyToolEffect('NotebookEdit', 'x.ipynb')).toBe('mutate');
    expect(classifyToolEffect('ReportConfidence', '80')).toBe('other');
    expect(classifyToolEffect('RetrieveResult', 'call_12')).toBe('other');
    expect(classifyToolEffect('Forge', 'build it')).toBe('other');
  });

  it('classifies the AgonX MCP aliases identically to the bare names', () => {
    expect(normalizeStepToolName('AgonBash')).toBe('bash');
    expect(classifyToolEffect('AgonEdit', 'x.ts')).toBe('mutate');
    expect(classifyToolEffect('AgonBash', 'cat x.ts')).toBe('read');
    expect(classifyToolEffect('AgonBash', 'npm test', GATE_MATCHERS)).toBe('verify');
  });
});

describe('primaryStepInput / normalizeStepSignature', () => {
  it('takes the identity-bearing argument per tool', () => {
    expect(primaryStepInput('Bash', { command: 'cat foo.py' })).toBe('cat foo.py');
    expect(primaryStepInput('Read', { file_path: 'a/b.ts' })).toBe('a/b.ts');
    expect(primaryStepInput('Grep', { pattern: 'foo', path: 'packages' })).toBe('foo packages');
    expect(primaryStepInput('Glob', { pattern: '**/*.kern' })).toBe('**/*.kern');
    expect(primaryStepInput('RetrieveResult', { id: 'call_9' })).toBe('call_9');
    expect(primaryStepInput('Weird', {})).toBe('');
  });

  // ── The paged-read hole (codex review N1) ──
  // A file bigger than the Read limit can only be read in pages. Keying the step
  // on file_path alone made page 2..n a read-REPEAT of page 1: the paging earned
  // no budget and fed the read-spiral/read-repeat guards, punishing the only
  // correct way to read a big file. offset/limit are identity, not decoration.
  it('keeps distinct paged reads of one big file distinct', () => {
    expect(primaryStepInput('Read', { file_path: 'a/b.ts', offset: 1, limit: 2000 })).toBe('a/b.ts offset=1 limit=2000');
    expect(primaryStepInput('Read', { file_path: 'a/b.ts', offset: 2001, limit: 2000 })).toBe('a/b.ts offset=2001 limit=2000');
    expect(canonicalStepSignature('Read', { file_path: 'a/b.ts', offset: 1 }))
      .not.toBe(canonicalStepSignature('Read', { file_path: 'a/b.ts', offset: 2001 }));
    // A re-read of the SAME window is still the same step.
    expect(canonicalStepSignature('Read', { file_path: 'a/b.ts', offset: 2001, limit: 500 }))
      .toBe(canonicalStepSignature('read', { file_path: 'a/b.ts', offset: 2001, limit: 500 }));
    // A whole-file read carries no window, so it keeps its historical identity —
    // it must never look like a different step from one turn to the next.
    expect(canonicalStepSignature('Read', { file_path: 'a/b.ts' })).toBe('read:a/b.ts');
    // offset 0 is a real value, not "unset" (a `?? ''` fallback would drop it).
    expect(primaryStepInput('Read', { file_path: 'a/b.ts', offset: 0 })).toBe('a/b.ts offset=0');
  });

  it('treats a Grep scope narrowing as a distinct step, and output formatting as the same one', () => {
    // glob/type narrow WHAT is searched, exactly like path — different results.
    expect(canonicalStepSignature('Grep', { pattern: 'foo', glob: '*.kern' }))
      .not.toBe(canonicalStepSignature('Grep', { pattern: 'foo', glob: '*.ts' }));
    expect(canonicalStepSignature('Grep', { pattern: 'foo', path: 'packages', type: 'ts' }))
      .not.toBe(canonicalStepSignature('Grep', { pattern: 'foo', path: 'packages' }));
    // Output-shaping flags return the SAME content — still a repeat.
    expect(canonicalStepSignature('Grep', { pattern: 'foo', path: 'packages', output_mode: 'count' }))
      .toBe(canonicalStepSignature('Grep', { pattern: 'foo', path: 'packages', output_mode: 'content', '-n': true }));
  });

  it('makes two reads of the same file one signature regardless of spacing or alias', () => {
    expect(normalizeStepSignature('Read', 'a/b.ts')).toBe(normalizeStepSignature('read', 'a/b.ts'));
    expect(normalizeStepSignature('Bash', 'cat   foo.py')).toBe(normalizeStepSignature('Bash', 'cat foo.py'));
    expect(normalizeStepSignature('Read', 'a/b.ts')).not.toBe(normalizeStepSignature('Read', 'a/c.ts'));
    // Case-sensitive paths stay distinct (macOS-insensitive FS notwithstanding).
    expect(normalizeStepSignature('Read', 'A.ts')).not.toBe(normalizeStepSignature('Read', 'a.ts'));
  });
});

// ── ONE canonical signature for every ledger (kimi #8 / minimax #9) ──
// Three per-turn ledgers hash steps: the core loop's earned-budget novelty set,
// the cli read-repeat ledger, and the brain's novel-step count. They used to be
// fed different shapes — a pre-stringified `{"command":"cat a.ts"}` here, a bare
// `cat a.ts` there — so one could see a repeat where another saw novelty.
// canonicalStepSignature is the single source of that identity.
describe('canonicalStepSignature', () => {
  it('hashes the same Bash call identically no matter which path built the args', () => {
    const fromArgs = canonicalStepSignature('Bash', { command: 'cat a.ts' });
    // What every caller must now produce — including the brain, which used to
    // hash the JSON blob it had already stringified for telemetry.
    expect(fromArgs).toBe('bash:cat a.ts');
    expect(fromArgs).not.toBe(normalizeStepSignature('Bash', JSON.stringify({ command: 'cat a.ts' })));
    // Sloppy spacing and the MCP alias collapse onto the same identity.
    expect(canonicalStepSignature('AgonBash', { command: 'cat   a.ts' })).toBe(fromArgs);
  });

  it('matches the primary-argument identity for every tool shape', () => {
    expect(canonicalStepSignature('Read', { file_path: 'a/b.ts' })).toBe('read:a/b.ts');
    expect(canonicalStepSignature('Read', { file_path: 'a/b.ts', offset: 40 })).toBe('read:a/b.ts offset=40');
    expect(canonicalStepSignature('Grep', { pattern: 'foo', path: 'packages' })).toBe('grep:foo packages');
    expect(canonicalStepSignature('Edit', { file_path: 'a/b.ts', new_string: 'x' })).toBe('edit:a/b.ts');
    // Same file, different edit content → still the same STEP identity: novelty
    // is about what a call touched, not how it spelled its payload.
    expect(canonicalStepSignature('Edit', { file_path: 'a/b.ts', new_string: 'y' }))
      .toBe(canonicalStepSignature('Edit', { file_path: 'a/b.ts', new_string: 'x' }));
  });

  it('falls back to the whole args record when a tool has no identity key', () => {
    // Without a fallback every ReportConfidence/orchestration call would collapse
    // into one signature and stop registering as distinct work.
    const a = canonicalStepSignature('ReportConfidence', { confidence: 0.8, basis: 'read the code' });
    const b = canonicalStepSignature('ReportConfidence', { confidence: 0.4, basis: 'read the code' });
    expect(a).not.toBe(b);
    // Key ORDER must not change the identity.
    expect(canonicalStepSignature('ReportConfidence', { basis: 'x', confidence: 1 }))
      .toBe(canonicalStepSignature('ReportConfidence', { confidence: 1, basis: 'x' }));
    expect(canonicalStepSignature('Weird', {})).toBe('weird:');
  });
});

describe('stepEarnsBudgetGrowth', () => {
  const entry = (effect: ToolStepEffectEntry['effect'], novel: boolean): ToolStepEffectEntry => ({ effect, novel });

  it('never earns growth on a step of pure read-repeats', () => {
    expect(stepEarnsBudgetGrowth([entry('read', false)])).toBe(false);
    expect(stepEarnsBudgetGrowth([entry('read', false), entry('read', false)])).toBe(false);
    expect(isReadRepeat('read', false)).toBe(true);
    expect(isReadRepeat('read', true)).toBe(false);
    expect(isReadRepeat('other', false)).toBe(false);
  });

  it('earns growth on novel reads, mutations, verification and unclassifiable work', () => {
    expect(stepEarnsBudgetGrowth([entry('read', true)])).toBe(true);
    expect(stepEarnsBudgetGrowth([entry('mutate', false)])).toBe(true);
    expect(stepEarnsBudgetGrowth([entry('verify', false)])).toBe(true);
    expect(stepEarnsBudgetGrowth([entry('other', false)])).toBe(true);
    // One earning call in a mixed batch is enough.
    expect(stepEarnsBudgetGrowth([entry('read', false), entry('read', true)])).toBe(true);
  });

  it('earns nothing for an empty step', () => {
    expect(stepEarnsBudgetGrowth([])).toBe(false);
    expect(stepEarnsBudgetGrowth(undefined as unknown as ToolStepEffectEntry[])).toBe(false);
  });
});

// ── The simulated native cycle the design is about ──
// Mirrors session-resume's growth accounting (+2 per 3 EARNING steps, base 15,
// cap 30) over a per-cycle signature ledger, so the ratchet is asserted on the
// same arithmetic the loop uses.
function simulateCycle(steps: Array<Array<{ tool: string; input: string }>>, gateMatchers: string[] = GATE_MATCHERS) {
  const seen = new Set<string>();
  let budget = 15;
  let productiveSteps = 0;
  for (const step of steps) {
    const entries: ToolStepEffectEntry[] = step.map((call) => {
      const signature = normalizeStepSignature(call.tool, call.input);
      const novel = !seen.has(signature);
      seen.add(signature);
      return { effect: classifyToolEffect(call.tool, call.input, gateMatchers), novel };
    });
    if (stepEarnsBudgetGrowth(entries)) {
      productiveSteps++;
      if (productiveSteps % 3 === 0 && budget < 30) budget = Math.min(budget + 2, 30);
    }
  }
  return { budget, productiveSteps };
}

describe('simulated native cycle budget growth', () => {
  it('keeps a re-read spiral at the base budget', () => {
    const steps = Array.from({ length: 30 }, () => [{ tool: 'Bash', input: 'cat packages/core/src/index.ts' }]);
    expect(simulateCycle(steps)).toEqual({ budget: 15, productiveSteps: 1 });
  });

  it('lets a genuine mapping pass keep earning', () => {
    const steps = Array.from({ length: 30 }, (_, i) => [{ tool: 'Read', input: `f${i}.ts` }]);
    expect(simulateCycle(steps).budget).toBe(30);
  });

  it('lets verify steps earn even when re-run with an identical command', () => {
    const steps = Array.from({ length: 9 }, () => [{ tool: 'Bash', input: 'npm test' }]);
    expect(simulateCycle(steps)).toEqual({ budget: 21, productiveSteps: 9 });
  });

  it('does not let a Bash re-read spiral hide behind one novel read per few steps', () => {
    const steps: Array<Array<{ tool: string; input: string }>> = [];
    for (let i = 0; i < 27; i++) {
      steps.push(i % 9 === 0
        ? [{ tool: 'Read', input: `new-${i}.ts` }]
        : [{ tool: 'Bash', input: 'cat packages/core/src/index.ts' }]);
    }
    // 3 novel reads + the single first (novel) cat = 4 earning steps → one grant.
    expect(simulateCycle(steps)).toEqual({ budget: 17, productiveSteps: 4 });
  });
});
