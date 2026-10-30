/** Advise a fitness-tested workflow for tasks classified as code. */
export function synthesisRoutingAdviceForTaskClass(taskClass: string): string | null {
  if (!['algorithm', 'refactor', 'bugfix', 'feature', 'test'].includes(taskClass)) return null;
  return [
    'Heads up: `agon synthesis` picks a winner by LLM judgment with no fitness test.',
    'If this task produces code you can test, prefer `agon forge -t "<test>"` — it selects by',
    "proven correctness and won't crown a confident-but-wrong artifact. If it's design, prose,",
    "or tradeoffs with no clean pass/fail, synthesis is the right tool — carry on.",
  ].join(' ');
}
