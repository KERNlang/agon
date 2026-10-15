import { hostRegexSplit, hostRegexTest } from './host-runtime.js';

/**
 * A cacheable prompt block. Stable blocks (system instructions, constraints) are cached across turns; dynamic blocks (task, diff) are not.
 */
export interface PromptBlock {
  role: 'system'|'user';
  content: string;
  cacheable: boolean;
}

/**
 * Split a prompt into cacheable blocks by ## section headers. Sections like CONSTRAINTS and INSTRUCTIONS are stable and cacheable; TASK, DIFF, QUESTION are dynamic.
 */
export function splitPromptBlocks(prompt: string): PromptBlock[] {
  const STABLE_HEADERS = /^##[ \t\n\r\f\v]*(CONSTRAINTS|INSTRUCTIONS|FITNESS TEST|REVIEW REQUEST)/i;
  const sections = hostRegexSplit(prompt, /(?=^## )/m);
  const blocks: PromptBlock[] = [];
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) {
      continue;
    }
    const isStable = hostRegexTest(trimmed, STABLE_HEADERS);
    blocks.push({ role: isStable ? 'system' : 'user', content: trimmed, cacheable: isStable });
  }
  // If no sections found, return whole prompt as a single user block
  if (blocks.length === 0) {
    blocks.push({ role: 'user', content: prompt, cacheable: false });
  }
  return blocks;
}

/**
 * Merge prompt blocks into system (cacheable) and user (dynamic) strings for APIs that support system/user message separation.
 */
export function mergeBlocksByRole(blocks: PromptBlock[]): {system:string, user:string} {
  const systemParts: string[] = [];
  const userParts: string[] = [];
  for (const block of blocks) {
    if (block.role === 'system') {
      systemParts.push(block.content);
    } else {
      userParts.push(block.content);
    }
  }
  return { system: systemParts.join('\n\n'), user: userParts.join('\n\n') };
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

export { buildForgePrompt, buildCritiquePrompt, buildSynthesisPrompt, buildForgePromptWithContext } from '@kernlang/agon-mod-forge';
