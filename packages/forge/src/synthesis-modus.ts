// Facade over ./generated/synthesis-modus.js — edit the source there.
export {
  runSynthesisModus,
  buildSynthesisDraftPrompt,
  buildSynthesisSwapPrompt,
  buildSynthesisJudgePrompt,
  shuffleSynthesisEnginesInPlace,
  parseSynthesisJudgeOutput,
  synthesisRoutingAdvice,
} from './generated/synthesis-modus.js';
export type {
  SynthesisDraft,
  SynthesisSwap,
  SynthesisScore,
  SynthesisResult,
  SynthesisOptions,
} from './generated/synthesis-modus.js';
