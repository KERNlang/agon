import { validateManifest } from '@kernlang/agon-mod-api';
import manifest from '../agon.mod.json' with { type: 'json' };
import ownership from '../ownership.json' with { type: 'json' };

export const MANIFEST = validateManifest(manifest);
export const SOURCE_OCCURRENCES = Object.freeze(ownership.assignments);

export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { normalizeSynthesisWinner, parseSynthesisJudgeOutput } from './judge-parser.js';
export type { SynthesisScore } from './judge-parser.js';
export { createSynthesisHostServices } from './host.js';
export type { SynthesisHostServices, SynthesisHostSession, SynthesisHostEffects, SynthesisModServices } from './host.js';
export {
  runSynthesisRuntime,
  buildSynthesisDraftPrompt,
  buildSynthesisSwapPrompt,
  buildSynthesisJudgePrompt,
  shuffleSynthesisEnginesInPlace,
} from './runtime.js';
export type { SynthesisDraft, SynthesisSwap, SynthesisResult, SynthesisRuntimeOptions, SynthesisRuntimeEvent, SynthesisRuntimeEffects } from './runtime.js';
export { runSynthesisSession } from './session-workflow.js';
export type { SynthesisSessionContext, SynthesisSessionCommandResult, SynthesisSessionEvent, SynthesisSessionHost } from './session-workflow.js';
