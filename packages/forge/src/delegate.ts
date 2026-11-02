import type { EngineRegistry, EngineAdapter } from '@kernlang/agon-core';
import { runDelegate as runOwnedDelegate } from '@kernlang/agon-mod-forge';
import type { DelegateResult } from '@kernlang/agon-mod-forge';
export type { DelegateResult } from '@kernlang/agon-mod-forge';

import { resolveWorkingDir } from '@kernlang/agon-core';

export async function runDelegate(opts: {engineId:string,task:string,mode?:string,cwd?:string,registry:EngineRegistry,adapter:EngineAdapter,timeout:number,outputDir:string,signal?:AbortSignal}): Promise<DelegateResult> {
  const engine = opts.registry.get(opts.engineId);
  // Explicit cwd keeps Goal dispatch inside its selected worktree.
  return runOwnedDelegate({
    engineId: opts.engineId, task: opts.task, mode: opts.mode,
    cwd: opts.cwd ?? resolveWorkingDir(), timeout: opts.timeout,
    outputDir: opts.outputDir, signal: opts.signal,
  }, request => opts.adapter.dispatch({ engine, ...request }));
}
