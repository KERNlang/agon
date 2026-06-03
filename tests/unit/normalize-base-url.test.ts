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

  // format-aware: the /anthropic strip is a legacy openai-only coercion. For
  // anthropic-format providers, /anthropic/v1 IS the correct base — stripping it
  // makes @ai-sdk/anthropic POST /v1/messages → 404 (the MiniMax-M3 bug).
  it('does NOT strip /anthropic for anthropic format (preserves the real route)', () => {
    expect(normalizeBaseUrl('https://api.minimax.io/anthropic/v1', 'anthropic')).toBe('https://api.minimax.io/anthropic/v1');
  });

  it('still strips /anthropic for openai format (legacy proxy-prefix behavior)', () => {
    expect(normalizeBaseUrl('https://proxy.com/anthropic/v1', 'openai')).toBe('https://proxy.com/v1');
  });

  it('leaves a plain anthropic-format URL untouched', () => {
    expect(normalizeBaseUrl('https://api.minimaxi.com/anthropic/v1', 'anthropic')).toBe('https://api.minimaxi.com/anthropic/v1');
  });
});
