import { loadConfig } from '@kernlang/agon-core';
import type { EngineAdapter, EngineRegistry } from '@kernlang/agon-core';
import { collectSemanticMutants as collectOwnedSemanticMutants } from '@kernlang/agon-mod-mutate';
import type { SemanticTarget, SemanticMutantsResult } from '@kernlang/agon-mod-mutate';

export { WRITE_GRANTING_ARGS, seatGrantsWriteAccess } from '@kernlang/agon-support-engine-runtime';
export { buildSemanticMutantPrompt, extractJsonArray, validateSemanticMutants, stripControlChars, normalizeLens, MUTATE_LENS_PRESETS, MUTATE_LENS_MAX_CHARS, SEMANTIC_MAX_FILES, SEMANTIC_MAX_LINES_PER_FILE } from '@kernlang/agon-mod-mutate';
export type { SemanticTargetLine, SemanticTarget, DroppedSemanticEntry, SemanticMutantsResult } from '@kernlang/agon-mod-mutate';

/** Dispatch only from a disposable sandbox. The prompt contains untrusted source. */
export async function collectSemanticMutants(opts: {targets:SemanticTarget[], sources:Record<string,string[]>, engines:string[], registry:EngineRegistry, adapter:EngineAdapter, perEngine:number, timeout:number, outputDir:string, cwd:string, lens?:string, signal?:AbortSignal, onEvent?:(e:{type:string,data?:Record<string,unknown>})=>void}): Promise<SemanticMutantsResult> {
  return collectOwnedSemanticMutants(opts, { loadConfig });
}
