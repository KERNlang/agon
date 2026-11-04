import { cleanText, scanText } from '@kernlang/agon-core';
import type { EngineRegistry } from '@kernlang/agon-core';
import {
  runNaturalizeWorkflow,
  type NaturalizeWorkflowOptions,
  type NaturalizeResult,
} from '@kernlang/agon-mod-naturalize/workflow';

export { buildNaturalizePrompt, stripDispatchWrapper } from '@kernlang/agon-mod-naturalize/workflow';
export type { NaturalizeResult } from '@kernlang/agon-mod-naturalize/workflow';
export { tokenizeWords, wordDiffStats } from '@kernlang/agon-mod-naturalize/lexical-policy';

export interface NaturalizeOptions extends Omit<NaturalizeWorkflowOptions, 'registry'> {
  registry: EngineRegistry;
}

// Preserve the legacy text policy until its physical owner has parity.
export function runNaturalize(opts: NaturalizeOptions): Promise<NaturalizeResult> {
  return runNaturalizeWorkflow(opts, { cleanText, scanText });
}
