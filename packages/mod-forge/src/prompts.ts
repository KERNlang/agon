import type { Critique } from './types.js';
import type { StageContext } from './stage-context.js';
import { renderStageContext } from './stage-context.js';

export function buildForgePrompt(opts: {task:string;fitnessCmd:string;context?:string;agentMode?:boolean}): string {
  const sections = [`## TASK\n${opts.task}`, `## FITNESS TEST\nRun this command to verify your work passes:\n\`\`\`\n${opts.fitnessCmd}\n\`\`\``];
  if (opts.context) {
    sections.push(`## CONTEXT\n${opts.context}`);
  }
  if (opts.agentMode) {
    sections.push(`## CONSTRAINTS\n- You have full tool access. Read files, edit code, run commands directly.\n- Fitness may already pass on the baseline. Do not treat a pre-existing pass as completion; inspect and implement the requested task first.\n- A forge candidate must produce a meaningful task-specific patch unless the requested change is already fully implemented.\n- If the requested change is already fully implemented, say that explicitly and leave the worktree clean.\n- Run the fitness test command to verify your work passes.\n- Iterate until the fitness test passes — read errors, fix them, re-run.\n- Modify only the files necessary to complete the task.\n- Exit when the task is implemented and the fitness test passes.\n- Do not ask questions — make reasonable assumptions.`);
  } else {
    sections.push(`## CONSTRAINTS\n- Write code, not plans. Implement the solution directly.\n- Fitness may already pass on the baseline. Do not treat a pre-existing pass as completion; inspect and implement the requested task first.\n- A forge candidate must produce a meaningful task-specific patch unless the requested change is already fully implemented.\n- If the requested change is already fully implemented, say that explicitly and leave the worktree clean.\n- Modify only the files necessary to complete the task.\n- Run the fitness test command to verify your work passes.\n- Exit when the task is implemented and the fitness test passes.\n- Do not ask questions — make reasonable assumptions.`);
  }
  return sections.join('\n\n');
}

export function buildCritiquePrompt(opts: {winnerEngine:string;diff:string;maxCritiques:number}): string {
  const cappedDiff = opts.diff.length > 50_000
    ? opts.diff.slice(0, 50_000) + '\n... [truncated]'
    : opts.diff;
  return `## TASK\nReview the following diff from "${opts.winnerEngine}" and provide constructive critiques.\n\n## DIFF\n\`\`\`diff\n${cappedDiff}\n\`\`\`\n\n## INSTRUCTIONS\nIdentify up to ${opts.maxCritiques} concrete issues with this diff. Focus on:\n- Bugs or logic errors (blocking)\n- Missing edge cases (blocking)\n- Security issues (blocking)\n- Performance problems (may be blocking)\n- Style nits (NOT blocking)\n\nReturn ONLY a JSON array (no markdown fencing, no extra text) with this format:\n[{"file":"path/to/file","lines":"N-M","problem":"description","minimal_fix":"code or description of fix","blocking":true}]\n\nSet "blocking":true ONLY for real bugs, logic errors, or security issues that must be fixed.\nSet "blocking":false for style nits, minor suggestions, or advisory comments.\nIf there are no real issues, return an empty array: []`;
}

export function buildSynthesisPrompt(opts: {diff:string;critiques:Critique[];fitnessCmd:string}): string {
  const critiquesText = opts.critiques
    .map((c, i) => `${i + 1}. **${c.file}** (lines ${c.lines}): ${c.problem}\n   Fix: ${c.minimalFix}`)
    .join('\n');
  return `## TASK\nApply valid critiques to improve your implementation.\n\n## YOUR CURRENT DIFF\n\`\`\`diff\n${opts.diff}\n\`\`\`\n\n## CRITIQUES TO ADDRESS\n${critiquesText}\n\n## FITNESS TEST\n\`\`\`\n${opts.fitnessCmd}\n\`\`\`\n\n## CONSTRAINTS\n- Apply only critiques that are valid and improve the code.\n- Ignore critiques that are wrong or would break the implementation.\n- The fitness test must still pass after applying changes.\n- Keep changes minimal — only address the critiques.`;
}

/**
 * Enhanced forge prompt builder that includes typed StageContext from prior stages.
 */
export function buildForgePromptWithContext(opts: {task:string;fitnessCmd:string;context?:string;agentMode?:boolean;stageContexts?:StageContext[]}): string {
  const sections = [`## TASK\n${opts.task}`, `## FITNESS TEST\nRun this command to verify your work passes:\n\`\`\`\n${opts.fitnessCmd}\n\`\`\``];
  if (opts.context) {
    sections.push(`## CONTEXT\n${opts.context}`);
  }
  // Inject StageContexts from prior engine runs
  if (opts.stageContexts && opts.stageContexts.length > 0) {
    const ctxSections = opts.stageContexts.map((ctx: StageContext) => renderStageContext(ctx));
    sections.push(ctxSections.join('\n\n---\n\n'));
  }
  if (opts.agentMode) {
    sections.push(`## CONSTRAINTS\n- You have full tool access. Read files, edit code, run commands directly.\n- Fitness may already pass on the baseline. Do not treat a pre-existing pass as completion; inspect and implement the requested task first.\n- A forge candidate must produce a meaningful task-specific patch unless the requested change is already fully implemented.\n- If the requested change is already fully implemented, say that explicitly and leave the worktree clean.\n- Run the fitness test command to verify your work passes.\n- Iterate until the fitness test passes — read errors, fix them, re-run.\n- Modify only the files necessary to complete the task.\n- Exit when the task is implemented and the fitness test passes.\n- Do not ask questions — make reasonable assumptions.`);
  } else {
    sections.push(`## CONSTRAINTS\n- Write code, not plans. Implement the solution directly.\n- Fitness may already pass on the baseline. Do not treat a pre-existing pass as completion; inspect and implement the requested task first.\n- A forge candidate must produce a meaningful task-specific patch unless the requested change is already fully implemented.\n- If the requested change is already fully implemented, say that explicitly and leave the worktree clean.\n- Modify only the files necessary to complete the task.\n- Run the fitness test command to verify your work passes.\n- Exit when the task is implemented and the fitness test passes.\n- Do not ask questions — make reasonable assumptions.`);
  }
  return sections.join('\n\n');
}
