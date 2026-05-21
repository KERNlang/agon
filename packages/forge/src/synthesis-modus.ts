// Re-export from KERN-generated synthesis modus.
export {
  runSynthesisModus,
  buildSynthesisDraftPrompt,
  buildSynthesisSwapPrompt,
  buildSynthesisJudgePrompt,
  shuffleSynthesisEnginesInPlace,
  parseSynthesisJudgeOutput,
} from './generated/synthesis-modus.js';
export type {
  SynthesisDraft,
  SynthesisSwap,
  SynthesisScore,
  SynthesisResult,
  SynthesisOptions,
} from './generated/synthesis-modus.js';
