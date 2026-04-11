/**
 * Kern Draft Protocol — local copy from @kernlang/protocol
 *
 * Structured communication format for competing AI engines.
 * Engines respond in Kern draft format instead of verbose natural language —
 * 70% fewer tokens, no fluff, structured and rankable.
 */

export interface KernDraft {
  approach: string;
  reasoning: string;
  tradeoffs: string[];
  confidence: number;
  keyFiles: string[];
  steps: string[];
}

export function buildKernDraftPrompt(opts: {
  question: string;
  context?: string;
  mode: 'brainstorm' | 'forge-plan' | 'tribunal-position';
}): string {
  const modeInstructions: Record<string, string> = {
    brainstorm: 'You are proposing an approach to a technical question. Be creative but specific.',
    'forge-plan': 'You are planning an implementation that will be scored against competing implementations. Be precise about files and steps.',
    'tribunal-position': 'You are taking a position in a technical tribunal. State your case clearly with evidence.',
  };
  const lines: string[] = [];
  lines.push(modeInstructions[opts.mode]);
  lines.push('');
  if (opts.context) {
    lines.push('## Project Context');
    lines.push(opts.context);
    lines.push('');
  }
  lines.push('## Question');
  lines.push(opts.question);
  lines.push('');
  lines.push('## Response Format');
  lines.push('');
  lines.push('Respond ONLY with a Kern draft block. No markdown, no explanation outside the block.');
  lines.push('');
  lines.push('```');
  lines.push('draft {');
  lines.push('  approach: "your one-line thesis"');
  lines.push('  reasoning: "why this approach works — 1-3 sentences max"');
  lines.push('  tradeoffs: "risk1", "risk2", "risk3"');
  lines.push('  confidence: 0-100');
  lines.push('  keyFiles: "src/file1.ts", "src/file2.ts"');
  lines.push('  steps {');
  lines.push('    1: "first step"');
  lines.push('    2: "second step"');
  lines.push('    3: "third step"');
  lines.push('  }');
  lines.push('}');
  lines.push('```');
  lines.push('');
  lines.push('Rules:');
  lines.push('- approach: single sentence, what you would do');
  lines.push('- reasoning: why, max 3 sentences');
  lines.push('- tradeoffs: comma-separated quoted strings, risks or downsides');
  lines.push('- confidence: integer 0-100, how sure you are');
  lines.push('- keyFiles: comma-separated quoted paths, files you would touch');
  lines.push('- steps: numbered, 3-7 concrete steps');
  lines.push('- No text outside the draft block');
  return lines.join('\n');
}

export function buildKernRankPrompt(drafts: { engineId: string; draft: KernDraft }[]): string {
  const lines: string[] = [];
  lines.push('Rank these drafts by: specificity (concrete vs vague), feasibility (can it actually work), and fit to project context.');
  lines.push('');
  for (const { engineId, draft } of drafts) {
    lines.push(`## ${engineId}`);
    lines.push(`Approach: ${draft.approach}`);
    lines.push(`Reasoning: ${draft.reasoning}`);
    lines.push(`Confidence: ${draft.confidence}`);
    lines.push(`Steps: ${draft.steps.length}`);
    lines.push(`Tradeoffs: ${draft.tradeoffs.join(', ')}`);
    lines.push('');
  }
  lines.push('Respond with ONLY the engine IDs in ranked order (best first), comma-separated:');
  lines.push('Example: engine2, engine1, engine3');
  return lines.join('\n');
}

function parseStringField(body: string, key: string): string | null {
  const regex = new RegExp(`^\\s*${key}\\s*:\\s*"([^"]*)"`, 'm');
  const match = body.match(regex);
  return match ? match[1] : null;
}

function parseNumberField(body: string, key: string): number | null {
  const regex = new RegExp(`^\\s*${key}\\s*:\\s*(\\d+)`, 'm');
  const match = body.match(regex);
  return match ? Number(match[1]) : null;
}

function parseQuotedList(body: string, key: string): string[] {
  const regex = new RegExp(`^\\s*${key}\\s*:\\s*(.+)`, 'm');
  const match = body.match(regex);
  if (!match) return [];
  const values = [...match[1].matchAll(/"([^"]*?)"/g)];
  return values.map((m) => m[1]);
}

export function parseKernDraft(output: string): KernDraft | null {
  let text = output;
  const fenceMatch = text.match(/```[\w]*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    text = fenceMatch[1];
  }
  const draftMatch = text.match(/draft\s*\{([\s\S]*)\}/);
  if (!draftMatch) return null;
  const body = draftMatch[1];
  const draft: KernDraft = {
    approach: '',
    reasoning: '',
    tradeoffs: [],
    confidence: 0,
    keyFiles: [],
    steps: [],
  };
  draft.approach = parseStringField(body, 'approach') || '';
  draft.reasoning = parseStringField(body, 'reasoning') || '';
  draft.confidence = parseNumberField(body, 'confidence') || 0;
  draft.tradeoffs = parseQuotedList(body, 'tradeoffs');
  draft.keyFiles = parseQuotedList(body, 'keyFiles');
  const stepsMatch = body.match(/steps\s*\{([\s\S]*?)\}/);
  if (stepsMatch) {
    const stepsBody = stepsMatch[1];
    const stepEntries = [...stepsBody.matchAll(/\d+\s?:\s?"([^"]*?)"/g)];
    draft.steps = stepEntries.map((m) => m[1]);
  }
  if (!draft.approach) return null;
  return draft;
}
