import { pipeline, env } from '@huggingface/transformers';
import { join } from 'node:path';
import { AGON_HOME } from '@agon/core';

// Cache models in ~/.agon/models/
env.cacheDir = join(AGON_HOME, 'models');

const MODEL_MAP: Record<string, string> = {
  'smollm2-360m': 'HuggingFaceTB/SmolLM2-135M-Instruct',
  'qwen-0.5b': 'onnx-community/Qwen2.5-0.5B-Instruct',
  'phi-3-mini': 'onnx-community/Phi-3-mini-4k-instruct-onnx-web',
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let generator: any = null;
let loadFailed = false;

/**
 * Load the Caesar model. Call once at startup.
 * Returns true if model loaded, false if unavailable.
 */
export async function loadCaesar(modelId: string): Promise<boolean> {
  if (modelId === 'none' || loadFailed) return false;

  const hfModel = MODEL_MAP[modelId];
  if (!hfModel) return false;

  try {
    generator = await (pipeline as Function)('text-generation', hfModel, {
      dtype: 'q4',
      device: 'cpu',
    });
    return true;
  } catch {
    loadFailed = true;
    return false;
  }
}

/** Check if Caesar is loaded and ready. */
export function isCaesarReady(): boolean {
  return generator !== null;
}

/**
 * Download the Caesar model (for onboarding).
 * Uses the same pipeline call — transformers.js handles download + caching.
 */
export async function downloadCaesar(
  modelId: string,
  onProgress?: (progress: { status: string; progress?: number }) => void,
): Promise<boolean> {
  if (modelId === 'none') return true;

  const hfModel = MODEL_MAP[modelId];
  if (!hfModel) return false;

  try {
    generator = await (pipeline as Function)('text-generation', hfModel, {
      dtype: 'q4',
      device: 'cpu',
      progress_callback: onProgress,
    });
    return true;
  } catch {
    return false;
  }
}

const ROUTE_PROMPT = `You are Caesar, an AI orchestrator. Given user input, respond with EXACTLY one word — the intent type.

Intent types:
- forge: user wants to fix, build, implement, refactor, or modify code
- brainstorm: user wants ideas, approaches, suggestions, or advice
- tribunal: user wants to compare, debate, or weigh trade-offs
- leaderboard: user asks about rankings or ELO scores
- history: user asks about past runs or recent activity
- engines: user asks about available AI engines
- config: user asks about settings
- help: user needs help
- exit: user wants to quit

User: "{input}"
Intent:`;

/**
 * Use Caesar to classify intent. Returns null if Caesar is unavailable
 * or if classification fails (caller should fall back to regex).
 */
export async function caesarClassify(input: string): Promise<string | null> {
  if (!generator) return null;

  try {
    const prompt = ROUTE_PROMPT.replace('{input}', input.slice(0, 200));
    const result = await generator(prompt, {
      max_new_tokens: 5,
      temperature: 0.1,
      do_sample: false,
    });

    // Extract the generated text after the prompt
    const output = (result as Array<{ generated_text: string }>)[0]?.generated_text ?? '';
    const answer = output.slice(prompt.length).trim().toLowerCase().split(/\s+/)[0];

    const validIntents = [
      'forge', 'brainstorm', 'tribunal', 'leaderboard',
      'history', 'engines', 'config', 'help', 'exit',
    ];
    if (validIntents.includes(answer)) return answer;
    return null;
  } catch {
    return null;
  }
}

const SUMMARIZE_PROMPT = `Summarize this forge competition result in 1-2 sentences. Be concise and direct.

Task: {task}
Winner: {winner} (score: {score})
Engines: {engines}
Results: {results}

Summary:`;

/**
 * Use Caesar to summarize forge results. Returns null if unavailable.
 */
export async function caesarSummarize(opts: {
  task: string;
  winner: string | null;
  score: number;
  engines: string[];
  results: Record<string, { pass: boolean; score: number }>;
}): Promise<string | null> {
  if (!generator) return null;

  try {
    const resultsStr = Object.entries(opts.results)
      .map(([id, r]) => `${id}: ${r.pass ? 'PASS' : 'FAIL'} (${r.score})`)
      .join(', ');

    const prompt = SUMMARIZE_PROMPT
      .replace('{task}', opts.task.slice(0, 100))
      .replace('{winner}', opts.winner ?? 'none')
      .replace('{score}', String(opts.score))
      .replace('{engines}', opts.engines.join(', '))
      .replace('{results}', resultsStr);

    const result = await generator(prompt, {
      max_new_tokens: 60,
      temperature: 0.3,
      do_sample: true,
    });

    const output = (result as Array<{ generated_text: string }>)[0]?.generated_text ?? '';
    return output.slice(prompt.length).trim() || null;
  } catch {
    return null;
  }
}
