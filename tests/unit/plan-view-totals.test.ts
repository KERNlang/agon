import { describe, expect, it } from 'vitest';

import { PlanProposalView } from '../../packages/cli/src/blocks/plan-view.js';

// PlanProposalView is a hook-free React.memo view, so it can be invoked as a
// plain function and its element tree read directly — no renderer needed.
const render = (props: Record<string, unknown>) => (PlanProposalView as any).type(props);

function textNodes(node: any, out: string[] = []): string[] {
  if (typeof node === 'string' || typeof node === 'number') { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const n of node) textNodes(n, out); return out; }
  if (node && node.props) textNodes(node.props.children, out);
  return out;
}

const step = (id: string, tokens: number, costUsd: number) => ({
  id,
  type: 'self',
  description: `step ${id}`,
  estimatedTokens: tokens,
  estimatedCostUsd: costUsd,
  state: 'pending',
});

const plan = (over: Record<string, unknown> = {}) => ({
  intent: 'ship the slice',
  steps: [step('s1', 1200, 0.4), step('s2', 800, 0.2)],
  ...over,
}) as any;

// The header line is the number the user approves a spend against. With no
// pre-computed estimate on the plan, the only source is the per-step SUM —
// a fold that subtracts instead of adds quotes a negative budget and hides
// the real cost of running the plan.
describe('PlanProposalView totals', () => {
  it('sums per-step estimates when the plan carries no totals', () => {
    const texts = textNodes(render({ plan: plan() }));

    expect(texts).toContain((2000).toLocaleString());
    expect(texts).toContain((0.4 + 0.2).toFixed(2));
    expect(texts).toContain(' steps · ~');
  });

  it('prefers a supplied cost estimate over the per-step sum', () => {
    const texts = textNodes(render({
      plan: plan(),
      costEstimate: { totalTokens: 4321, totalCostUsd: 2.5, steps: [] },
    }));

    expect(texts).toContain((4321).toLocaleString());
    expect(texts).toContain('2.50');
  });

  it('prefers the plan-level totals over the per-step sum', () => {
    const texts = textNodes(render({ plan: plan({ totalEstimatedTokens: 7654, totalEstimatedCostUsd: 3.25 }) }));

    expect(texts).toContain((7654).toLocaleString());
    expect(texts).toContain('3.25');
  });

  it('reports zero for a plan with no steps at all', () => {
    const texts = textNodes(render({ plan: plan({ steps: [] }) }));

    expect(texts).toContain('0');
    expect(texts).toContain('0.00');
  });
});
