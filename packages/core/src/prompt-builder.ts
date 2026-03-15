import type { Critique } from './types.js';

/**
 * Build the forge execution prompt sent to an engine.
 */
export function buildForgePrompt(opts: {
  task: string;
  fitnessCmd: string;
  context?: string;
}): string {
  const sections = [
    `## TASK\n${opts.task}`,
    `## FITNESS TEST\nRun this command to verify your work passes:\n\`\`\`\n${opts.fitnessCmd}\n\`\`\``,
  ];

  if (opts.context) {
    sections.push(`## CONTEXT\n${opts.context}`);
  }

  sections.push(
    `## CONSTRAINTS
- Write code, not plans. Implement the solution directly.
- Modify only the files necessary to complete the task.
- Run the fitness test command to verify your work passes.
- Exit when the fitness test passes.
- Do not ask questions — make reasonable assumptions.`,
  );

  return sections.join('\n\n');
}

/**
 * Build the critique prompt sent to a losing engine.
 */
export function buildCritiquePrompt(opts: {
  winnerEngine: string;
  diff: string;
  maxCritiques: number;
}): string {
  // Cap diff at 50K chars
  const cappedDiff = opts.diff.length > 50_000
    ? opts.diff.slice(0, 50_000) + '\n... [truncated]'
    : opts.diff;

  return `## TASK
Review the following diff from "${opts.winnerEngine}" and provide constructive critiques.

## DIFF
\`\`\`diff
${cappedDiff}
\`\`\`

## INSTRUCTIONS
Identify up to ${opts.maxCritiques} concrete issues with this diff. Focus on:
- Bugs or logic errors
- Missing edge cases
- Security issues
- Performance problems
- Style violations

Return ONLY a JSON array (no markdown fencing, no extra text) with this format:
[{"file":"path/to/file","lines":"N-M","problem":"description","minimal_fix":"code or description of fix"}]

If there are no real issues, return an empty array: []`;
}

/**
 * Build the synthesis prompt sent to the winner for refinement.
 */
export function buildSynthesisPrompt(opts: {
  diff: string;
  critiques: Critique[];
  fitnessCmd: string;
}): string {
  const critiquesText = opts.critiques
    .map(
      (c, i) =>
        `${i + 1}. **${c.file}** (lines ${c.lines}): ${c.problem}\n   Fix: ${c.minimalFix}`,
    )
    .join('\n');

  return `## TASK
Apply valid critiques to improve your implementation.

## YOUR CURRENT DIFF
\`\`\`diff
${opts.diff}
\`\`\`

## CRITIQUES TO ADDRESS
${critiquesText}

## FITNESS TEST
\`\`\`
${opts.fitnessCmd}
\`\`\`

## CONSTRAINTS
- Apply only critiques that are valid and improve the code.
- Ignore critiques that are wrong or would break the implementation.
- The fitness test must still pass after applying changes.
- Keep changes minimal — only address the critiques.`;
}

/**
 * Build the brainstorm confidence-bidding prompt.
 */
export function buildBrainstormPrompt(opts: {
  question: string;
  context?: string;
}): string {
  return `## QUESTION
${opts.question}

${opts.context ? `## CONTEXT\n${opts.context}\n\n` : ''}## INSTRUCTIONS
Respond with a JSON object (no markdown fencing):
{
  "confidence": <number 1-100>,
  "reasoning": "<why you're confident>",
  "approach": "<your approach to answering>"
}

Rate your confidence honestly. Higher confidence = you'll be chosen to answer.`;
}

/**
 * Build the tribunal debate prompt.
 */
export function buildTribunalPrompt(opts: {
  question: string;
  position: string;
  round: number;
  totalRounds: number;
  previousArguments?: string;
}): string {
  return `## DEBATE
Question: ${opts.question}

Your position: ${opts.position}
Round: ${opts.round}/${opts.totalRounds}

${opts.previousArguments ? `## PREVIOUS ARGUMENTS\n${opts.previousArguments}\n\n` : ''}## INSTRUCTIONS
Present your argument with evidence. Format each piece of evidence as:
{"claim":"statement","file":"path","lines":"N-M","evidence":"quoted code","severity":1-5}

${opts.round > 1 ? 'Address and counter the previous arguments.' : 'Make your opening argument.'}`;
}

/**
 * Build a review prompt with diff context.
 */
export function buildReviewPrompt(opts: {
  prompt: string;
  diff: string;
}): string {
  // Cap diff at 100K chars
  const cappedDiff = opts.diff.length > 100_000
    ? opts.diff.slice(0, 100_000) + '\n... [truncated]'
    : opts.diff;

  return `## REVIEW REQUEST
${opts.prompt}

## DIFF
\`\`\`diff
${cappedDiff}
\`\`\``;
}
