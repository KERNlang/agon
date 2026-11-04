/**
 * Unit tests for the `flowError` factory: the optional `port`/`file` fields
 * must be copied when supplied and left absent (not set to `undefined`) when
 * they are not, since `formatFlowError` and the JSON diagnostics both read them.
 */
import { describe, expect, it } from 'vitest';

import { flowError, formatFlowError } from '../../packages/mod-flow/src/core/index.js';

describe('flowError', () => {
  it('carries port and file through when both are supplied', () => {
    const error = flowError('PORT_UNRESOLVED', 'step-a', 'no such port', {
      port: 'prompt', file: '/flows/main.agon-flow.json',
    });
    expect(error.port).toBe('prompt');
    expect(error.file).toBe('/flows/main.agon-flow.json');
    expect(formatFlowError(error)).toBe('[PORT_UNRESOLVED] step-a.prompt: no such port');
  });

  it('carries port through when it is the only extra supplied', () => {
    const error = flowError('PORT_TYPE_MISMATCH', 'step-b', 'text ≠ file', { port: 'in' });
    expect(error.port).toBe('in');
    expect('file' in error).toBe(false);
  });

  it('omits port and file entirely when no extras are supplied', () => {
    const error = flowError('CYCLE', 'step-a', 'cycle detected');
    expect('port' in error).toBe(false);
    expect('file' in error).toBe(false);
    expect(formatFlowError(error)).toBe('[CYCLE] step-a: cycle detected');
  });
});
