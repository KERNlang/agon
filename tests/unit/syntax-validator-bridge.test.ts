import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Hermetic: the Python sidecar is stubbed at the process boundary so the test
// can PROVE the batch actually reached the validator (spawnSync call count +
// payload) rather than relying on "the answer wasn't []".
const spawnSyncMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ spawnSync: spawnSyncMock }));
vi.mock('../../packages/core/src/blocks/dedup-resolver.js', () => ({
  resolveDedupSidecar: vi.fn(() => '/fake/sidecar/syntax-validator.py'),
  resolveSidecarPython: vi.fn(() => 'python3'),
}));

import {
  validateSyntax,
  detectLanguageFromPath,
  SYNTAX_VALIDATOR_DISABLE_ENV,
  SYNTAX_VALIDATOR_TIMEOUT_MS,
} from '../../packages/core/src/blocks/syntax-validator-bridge.js';

// The empty-batch guard is a fast path, NOT a kill switch: `[]` in → `[]`
// out without paying for a sidecar spawn, but a real batch must always reach
// the validator. Inverting the guard turns every validation call into a
// silent "all files fine" (`[]`), which reads as "nothing to report" at every
// call site.

const FILE = { path: 'a.ts', content: 'const a = 1;\n', language: 'typescript' };

function sidecarAnswers(results: unknown[], status = 0): void {
  spawnSyncMock.mockReturnValue({ status, stdout: JSON.stringify({ results }), stderr: '' });
}

let savedDisable: string | undefined;

beforeEach(() => {
  savedDisable = process.env[SYNTAX_VALIDATOR_DISABLE_ENV];
  delete process.env[SYNTAX_VALIDATOR_DISABLE_ENV];
  spawnSyncMock.mockReset();
  sidecarAnswers([{ path: 'a.ts', valid: true, language: 'typescript', errors: [] }]);
});

afterEach(() => {
  if (savedDisable === undefined) delete process.env[SYNTAX_VALIDATOR_DISABLE_ENV];
  else process.env[SYNTAX_VALIDATOR_DISABLE_ENV] = savedDisable;
});

describe('validateSyntax batching guard', () => {
  it('short-circuits an EMPTY batch to [] WITHOUT spawning the sidecar', () => {
    expect(validateSyntax([])).toEqual([]);
    expect(spawnSyncMock).not.toHaveBeenCalled();
  });

  it('sends a NON-empty batch to the sidecar and returns its verdict', () => {
    const result = validateSyntax([FILE]);

    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
    const [python, args, opts] = spawnSyncMock.mock.calls[0];
    expect(python).toBe('python3');
    expect(args).toEqual(['/fake/sidecar/syntax-validator.py']);
    expect(JSON.parse((opts as { input: string }).input)).toEqual({ files: [FILE] });
    expect(opts).toMatchObject({ timeout: SYNTAX_VALIDATOR_TIMEOUT_MS, encoding: 'utf-8' });

    expect(result).toEqual([
      { path: 'a.ts', valid: true, language: 'typescript', errors: [], languageUnsupported: undefined, grammarUnavailable: undefined },
    ]);
  });

  it('forwards every file in a multi-file batch', () => {
    const second = { path: 'b.py', content: 'x = 1\n', language: 'python' };
    sidecarAnswers([
      { path: 'a.ts', valid: false, language: 'typescript', errors: [{ row: 1, column: 2, message: 'ERROR' }] },
      { path: 'b.py', valid: true, language: 'python', errors: [] },
    ]);

    const result = validateSyntax([FILE, second]);

    expect(JSON.parse(spawnSyncMock.mock.calls[0][2].input)).toEqual({ files: [FILE, second] });
    expect(result).toHaveLength(2);
    expect(result![0]).toMatchObject({ path: 'a.ts', valid: false, errors: [{ row: 1, column: 2, message: 'ERROR' }] });
    expect(result![1]).toMatchObject({ path: 'b.py', valid: true });
  });

  it('treats exit 3 (unsupported language in the batch) as a successful run', () => {
    sidecarAnswers([{ path: 'a.rs', valid: true, language: '', errors: [], language_unsupported: true }], 3);
    const result = validateSyntax([{ path: 'a.rs', content: 'fn main() {}', language: '' }]);
    expect(result).toHaveLength(1);
    expect(result![0].languageUnsupported).toBe(true);
  });

  it('returns null (no signal) when the sidecar fails', () => {
    spawnSyncMock.mockReturnValue({ status: 1, stdout: '', stderr: 'boom' });
    expect(validateSyntax([FILE])).toBeNull();
    expect(spawnSyncMock).toHaveBeenCalledTimes(1);
  });

  it('honours the disable env var ahead of everything else', () => {
    process.env[SYNTAX_VALIDATOR_DISABLE_ENV] = '1';
    expect(validateSyntax([])).toBeNull();
    expect(validateSyntax([FILE])).toBeNull();
    expect(spawnSyncMock).not.toHaveBeenCalled();
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
