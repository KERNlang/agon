import type { DispatchOptions, DispatchResult } from '@kernlang/agon-support-engine-runtime';

export interface DelegateResult {
  engineId: string;
  response: string;
  usage?: DispatchResult['usage'];
}

export interface DelegateInput {
  engineId: string;
  task: string;
  mode?: string | undefined;
  cwd: string;
  timeout: number;
  outputDir: string;
  signal?: AbortSignal | undefined;
}

/** Execute through the caller's admitted adapter; preserve its failures. */
export async function runDelegate(
  opts: DelegateInput,
  dispatch: (request: Omit<DispatchOptions, 'engine'>) => Promise<DispatchResult>,
): Promise<DelegateResult> {
  const result = await dispatch({
    prompt: opts.task, cwd: opts.cwd, mode: (opts.mode ?? 'exec') as DispatchOptions['mode'],
    timeout: opts.timeout, outputDir: opts.outputDir, signal: opts.signal,
  });
  if (!result.stdout.trim()) {
    return { engineId: opts.engineId, response: '', usage: result.usage };
  }
  const cleaned = result.stdout.trim().replace(/<think>[ \t\n\r\f\v\S]*?<\/think>[ \t\n\r\f\v]*/gi, '').trim();
  return { engineId: opts.engineId, response: cleaned, usage: result.usage };
}
