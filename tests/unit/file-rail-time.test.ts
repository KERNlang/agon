import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatRelativeTime } from '../../packages/cli/src/generated/blocks/file-rail.js';

describe('formatRelativeTime', () => {
  afterEach(() => vi.useRealTimers());

  it('renders future timestamps honestly', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-13T12:00:00.000Z'));
    expect(formatRelativeTime(Date.now() + 10_000)).toBe('in 10s');
    expect(formatRelativeTime(Date.now() + 120_000)).toBe('in 2m');
  });
});
