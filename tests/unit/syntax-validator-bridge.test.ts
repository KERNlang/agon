import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  validateSyntax,
  detectLanguageFromPath,
  SYNTAX_VALIDATOR_DISABLE_ENV,
} from '../../packages/core/src/blocks/syntax-validator-bridge.js';

// The empty-batch guard is a fast path, NOT a kill switch: `[]` in → `[]`
// out without paying for a Python sidecar spawn, but a real batch must
// always reach the validator. Inverting the guard turns every validation
// call into a silent "all files fine" (`[]`), which reads as
// "nothing to report" at every call site.

let savedDisable: string | undefined;

beforeEach(() => {
  savedDisable = process.env[SYNTAX_VALIDATOR_DISABLE_ENV];
  delete process.env[SYNTAX_VALIDATOR_DISABLE_ENV];
});

afterEach(() => {
  if (savedDisable === undefined) delete process.env[SYNTAX_VALIDATOR_DISABLE_ENV];
  else process.env[SYNTAX_VALIDATOR_DISABLE_ENV] = savedDisable;
});

describe('validateSyntax batching guard', () => {
  it('short-circuits an EMPTY batch to an empty result list', () => {
    expect(validateSyntax([])).toEqual([]);
  });

  it('does not short-circuit a NON-empty batch', () => {
    const result = validateSyntax([{ path: 'a.ts', content: 'const a = 1;\n', language: 'typescript' }]);
    // Either the sidecar answered (one result per file) or it is unavailable
    // (null = no signal). An empty array would mean the batch was dropped.
    expect(result).not.toEqual([]);
    if (result !== null) {
      expect(result).toHaveLength(1);
      expect(result[0].path).toBe('a.ts');
    }
  });

  it('honours the disable env var ahead of everything else', () => {
    process.env[SYNTAX_VALIDATOR_DISABLE_ENV] = '1';
    expect(validateSyntax([])).toBeNull();
    expect(validateSyntax([{ path: 'a.ts', content: 'const a = 1;\n', language: 'typescript' }])).toBeNull();
  });
});

describe('detectLanguageFromPath', () => {
  it('maps known extensions', () => {
    expect(detectLanguageFromPath('/x/a.ts')).toBe('typescript');
    expect(detectLanguageFromPath('/x/a.TSX')).toBe('tsx');
    expect(detectLanguageFromPath('/x/a.py')).toBe('python');
  });

  it('returns empty string for unknown extensions', () => {
    expect(detectLanguageFromPath('/x/a.rs')).toBe('');
    expect(detectLanguageFromPath('/x/README')).toBe('');
  });
});
