import { describe, expect, it } from 'vitest';

import { companionDispatch } from '../../packages/core/src/generated/sessions/companion-dispatch.js';

describe('companionDispatch', () => {
  it('returns an error result instead of crashing when companion stdin closes early', async () => {
    const result = await companionDispatch({
      binaryPath: process.execPath,
      config: {
        protocol: 'stream-json',
        serverCmd: ['-e', 'process.exit(0)'],
      },
      prompt: 'hello',
      cwd: process.cwd(),
      timeout: 1,
      mode: 'exec',
    });

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toMatch(/Companion stdin closed|Turn timed out|stdin|EPIPE/i);
  });
});
