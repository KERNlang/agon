import type { Critique } from './types.js';

export function buildForgePrompt(opts: {task:string;fitnessCmd:string;context?:string;agentMode?:boolean}): string {
  const sections = [
    `## TASK\n${opts.task}`,
    `## FITNESS TEST\nRun this command to verify your work passes:\n\`\`\`\n${opts.fitnessCmd}\n\`\`\``,
  ];
  if (opts.context) sections.push(`## CONTEXT\n${opts.context}`);
  if (opts.agentMode) {
    sections.push(
      `## CONSTRAINTS\n- You have full tool access. Read files, edit code, run commands directly.\n- Run the fitness test command to verify your work passes.\n- Iterate until the fitness test passes — read errors, fix them, re-run.\n- Modify only the files necessary to complete the task.\n- Exit when the fitness test passes.\n- Do not ask questions — make reasonable assumptions.`,
    );
  } else {
    sections.push(
      `## CONSTRAINTS\n- Write code, not plans. Implement the solution directly.\n- Modify only the files necessary to complete the task.\n- Run the fitness test command to verify your work passes.\n- Exit when the fitness test passes.\n- Do not ask questions — make reasonable assumptions.`,
    );
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

export function buildBrainstormPrompt(opts: {question:string;context?:string}): string {
  return `## QUESTION\n${opts.question}\n\n${opts.context ? `## CONTEXT\n${opts.context}\n\n` : ''}## INSTRUCTIONS\nRespond with a JSON object (no markdown fencing):\n{\n  "confidence": <number 1-100>,\n  "reasoning": "<why you're confident>",\n  "approach": "<your approach to answering>"\n}\n\nRate your confidence honestly. Higher confidence = you'll be chosen to answer.`;
}

export function buildTribunalPrompt(opts: {question:string;position:string;round:number;totalRounds:number;previousArguments?:string}): string {
  return `## DEBATE\nQuestion: ${opts.question}\n\nYour position: ${opts.position}\nRound: ${opts.round}/${opts.totalRounds}\n\n${opts.previousArguments ? `## PREVIOUS ARGUMENTS\n${opts.previousArguments}\n\n` : ''}## INSTRUCTIONS\nPresent your argument with evidence. Format each piece of evidence as:\n{"claim":"statement","file":"path","lines":"N-M","evidence":"quoted code","severity":1-5}\n\n${opts.round > 1 ? 'Address and counter the previous arguments.' : 'Make your opening argument.'}`;
}

export function buildReviewPrompt(opts: {prompt:string;diff:string}): string {
  const cappedDiff = opts.diff.length > 100_000
    ? opts.diff.slice(0, 100_000) + '\n... [truncated]'
    : opts.diff;
  return `## REVIEW REQUEST\n${opts.prompt}\n\n## DIFF\n\`\`\`diff\n${cappedDiff}\n\`\`\``;
}

