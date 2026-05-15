// ── Re-export from KERN-generated syntax validator bridge ─────────
// Source of truth: src/kern/blocks/syntax-validator-bridge.kern
// Keep explicit exports in sync so static guard checks can resolve this facade.
export {
  SYNTAX_VALIDATOR_DISABLE_ENV,
  SYNTAX_VALIDATOR_TIMEOUT_MS,
  detectLanguageFromPath,
  validateSyntax,
} from './generated/blocks/syntax-validator-bridge.js';
export type {
  SyntaxValidationError,
  SyntaxValidatorInput,
  SyntaxValidatorResult,
} from './generated/blocks/syntax-validator-bridge.js';
