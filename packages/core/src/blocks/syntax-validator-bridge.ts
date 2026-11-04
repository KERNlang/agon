/**
 * @deprecated S4 compatibility adapter.
 *
 * Browser-bridge owns syntax validation. The legacy core surface injects the
 * independently packaged dedup sidecar locator, preserving the frozen sibling
 * dependency graph.
 */
import {
  validateSyntaxWithRuntime,
  type SyntaxValidatorInput,
  type SyntaxValidatorResult,
} from '@kernlang/agon-support-browser-bridge';
import { resolveDedupSidecar, resolveSidecarPython } from './dedup-resolver.js';

export * from '@kernlang/agon-support-browser-bridge';

export function validateSyntax(files: SyntaxValidatorInput[]): SyntaxValidatorResult[] | null {
  return validateSyntaxWithRuntime(files, {
    resolveSidecar: resolveDedupSidecar,
    resolvePython: resolveSidecarPython,
  });
}
