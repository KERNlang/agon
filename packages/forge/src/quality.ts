import { validateSyntax, detectLanguageFromPath } from '@kernlang/agon-core';
import { runSyntaxCheck as runOwnedSyntaxCheck } from '@kernlang/agon-mod-forge';
import type { SyntaxCheckResult } from '@kernlang/agon-mod-forge';

export { runLint, runStyleCheck, changedFilesIncludingUntracked, MAX_SYNTAX_FILE_BYTES } from '@kernlang/agon-mod-forge';
export type { SyntaxCheckResult } from '@kernlang/agon-mod-forge';

export function runSyntaxCheck(worktreePath: string): SyntaxCheckResult {
  return runOwnedSyntaxCheck(worktreePath, { validateSyntax, detectLanguageFromPath });
}
