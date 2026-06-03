import { describe, it, expect } from 'vitest';
import { guiUnavailableHint } from '../../packages/core/src/generated/tools/tool-bash.js';

describe('guiUnavailableHint (#8 GUI-on-CLI detection)', () => {
  it('hints for allowlisted GUI-launch commands', () => {
    expect(guiUnavailableHint('electron .', '')).toMatch(/headless/i);
    expect(guiUnavailableHint('pnpm studio', '')).toMatch(/headless/i);
    expect(guiUnavailableHint('npm run studio', '')).toMatch(/headless/i);
    expect(guiUnavailableHint('npm run gui', '')).toMatch(/headless/i);
  });

  it('hints when stderr shows a display failure', () => {
    expect(guiUnavailableHint('some-tool', 'Error: cannot open display :0')).toMatch(/headless/i);
    expect(guiUnavailableHint('xeyes', 'DISPLAY not set')).toMatch(/headless/i);
  });

  it('returns null for ordinary commands and unrelated failures (narrow by design)', () => {
    expect(guiUnavailableHint('npm test', '')).toBeNull();
    expect(guiUnavailableHint('npm run build', 'TypeError: foo')).toBeNull();
    expect(guiUnavailableHint('git status', '')).toBeNull();
    // a 'studio' substring elsewhere must NOT trigger the hint
    expect(guiUnavailableHint('cat studio-notes.md', '')).toBeNull();
  });
});
