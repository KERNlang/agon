import { describe, it, expect } from 'vitest';
import { normalizeBaseUrl } from '../../packages/core/src/generated/signals/models-registry.js';

describe('normalizeBaseUrl', () => {
  it('strips /anthropic/ when it is the first path segment (proxy prefix)', () => {
    expect(normalizeBaseUrl('https://proxy.com/anthropic/v1')).toBe('https://proxy.com/v1');
  });

  it('strips /anthropic at end of URL (proxy prefix, no trailing slash)', () => {
    expect(normalizeBaseUrl('https://proxy.com/anthropic')).toBe('https://proxy.com');
  });

  it('does NOT strip /anthropic/ when it appears deeper in the path', () => {
    expect(normalizeBaseUrl('https://gateway.com/v1/anthropic')).toBe('https://gateway.com/v1/anthropic');
  });

  it('does NOT strip /anthropic from the hostname', () => {
    expect(normalizeBaseUrl('https://api.anthropic.com/v1')).toBe('https://api.anthropic.com/v1');
  });

  it('handles proxy with deeper path after /anthropic/', () => {
    expect(normalizeBaseUrl('https://proxy.com/anthropic/v1/messages')).toBe('https://proxy.com/v1/messages');
  });

  it('returns malformed URL unchanged', () => {
    expect(normalizeBaseUrl('not-a-url')).toBe('not-a-url');
  });

  it('returns URL without /anthropic/ unchanged', () => {
    expect(normalizeBaseUrl('https://api.openai.com/v1')).toBe('https://api.openai.com/v1');
  });
});
