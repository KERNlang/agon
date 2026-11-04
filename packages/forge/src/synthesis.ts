import { worktreeCreate, worktreeRemoveBestEffort, applyPatch, worktreeDiff, diffLineCount, diffFileCount } from '@kernlang/agon-core';
import { createForgeSynthesis } from '@kernlang/agon-mod-forge';
import { runSyntaxCheck } from './quality.js';

export { parseCritiques } from '@kernlang/agon-mod-forge';

export const { runSynthesis } = createForgeSynthesis({
  worktreeCreate,
  worktreeRemoveBestEffort,
  applyPatch,
  fitness: { worktreeDiff, diffLineCount, diffFileCount, runSyntaxCheck },
});
