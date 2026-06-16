import { describe, expect, it } from 'vitest';
import { extractAdjacentForkOptions } from '../../packages/cli/src/generated/cesar/fork-options.js';

describe('extractAdjacentForkOptions — end-of-turn fork detection', () => {
  it('detects a contiguous option block directly above the closing question', () => {
    const response = [
      'Here are your options:',
      '1. Add an undo/redo history panel',
      '2. Wire multi-select',
      '3. Pivot to the inspector',
      'Which one do you want?',
    ].join('\n');
    const opts = extractAdjacentForkOptions(response);
    expect(opts.map((o: any) => o.key)).toEqual(['1', '2', '3']);
    expect(opts[0].full).toBe('Add an undo/redo history panel');
  });

  it('returns [] for a DESCRIPTION list separated from the question by prose (the screenshot bug)', () => {
    const response = [
      'phase-2-duplicate-rename is shipped and verified — commit e4bca5b is on the branch.',
      '',
      'All five spec requirements are live in the file:',
      '',
      '1. duplicateSelectedObject() (renderer.js:5843) — reads the selected object from state.',
      '2. Ctrl+D wiring (renderer.js:1762-1766) — guards on isSceneMode().',
      '3. Inline rename — name dblclick (renderer.js:454-458) — checks event.target.',
      '4. beginInlineRename() (renderer.js:529-580) — makes the name span contenteditable.',
      '5. CSS (styles.css:552-561) — .tree-item .name[contenteditable="true"] styled.',
      '',
      'node --check clean, 71/71 tests green, working tree clean. Nothing left to execute from this step.',
      '',
      "What's next — the roadmap had a few directions (undo/redo, multi-select, or pivoting). Which way do you want to go?",
    ].join('\n');
    // Prose ("node --check clean…") sits between the list and the question, so
    // the numbered list is a description, NOT a fork — no picker.
    expect(extractAdjacentForkOptions(response)).toEqual([]);
  });

  it('includes the last option when the question is appended to its line', () => {
    // Regression guard (claude review): the closing question on the same line as
    // the final option must not drop that option.
    const response = ['1. add undo/redo', '2. wire multi-select', '3. pivot to the inspector — which do you want?'].join('\n');
    const opts = extractAdjacentForkOptions(response);
    expect(opts.map((o: any) => o.key)).toEqual(['1', '2', '3']);
    expect(opts[2].full).toContain('pivot to the inspector');
  });

  it('tolerates blank lines between options', () => {
    const response = ['A) first', '', 'B) second', '', 'C) third', 'Pick one?'].join('\n');
    expect(extractAdjacentForkOptions(response).map((o: any) => o.key)).toEqual(['a', 'b', 'c']);
  });

  it('breaks the block at the first prose line above the question', () => {
    const response = [
      '1. keep option one',
      'some clarifying prose that is not an option',
      '2. keep option two',
      'Which?',
    ].join('\n');
    // Only the contiguous run directly above the question counts → just option 2.
    expect(extractAdjacentForkOptions(response).map((o: any) => o.key)).toEqual(['2']);
  });

  it('word-boundary truncates a long label but preserves full', () => {
    const long = 'duplicateSelectedObject() (renderer.js:5843) — reads the selected object and clones every attribute it owns';
    const response = ['1. ' + long, '2. short one', 'Which one?'].join('\n');
    const opts = extractAdjacentForkOptions(response, 72);
    expect(opts[0].full).toBe(long);
    expect(opts[0].label.length).toBeLessThanOrEqual(73); // <= limit + ellipsis
    expect(opts[0].label.endsWith('…')).toBe(true);
    const body = opts[0].label.slice(0, -1); // visible text without the ellipsis
    expect(long.startsWith(body)).toBe(true);  // it's a real prefix of full
    expect(long.charAt(body.length)).toBe(' '); // the cut landed on a space (word boundary), not mid-word
  });

  it('returns [] when there is no numbered/lettered list at all', () => {
    expect(extractAdjacentForkOptions('Just a plain answer. Anything else?')).toEqual([]);
  });

  it('returns [] for an empty / whitespace response', () => {
    expect(extractAdjacentForkOptions('')).toEqual([]);
    expect(extractAdjacentForkOptions('   \n  \n')).toEqual([]);
  });
});
