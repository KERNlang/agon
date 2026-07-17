import { afterEach, describe, expect, it, vi } from 'vitest';

import { appendInputHistory, cleanInputValue, cleanSubmitValue, findInputChange, getSlashMatches, hasBtwSideChannelTarget, movePickerCursor, parseAutoModeCommand, parsePermissionModeCommand, resolveEscapeAction, shouldQueuePlanModeOnTab, tryGhostComplete } from '../../packages/cli/src/generated/signals/app-input.js';
import { expandPastePlaceholders, processPasteContent, recordPastePlaceholder } from '../../packages/cli/src/generated/signals/paste-handler.js';
import { pasteStore } from '@kernlang/agon-core';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('app input helpers', () => {
  it('preserves pasted tabs and newlines while stripping bracketed paste markers', () => {
    expect(cleanInputValue('\x1b[200~\tif true:\n\t\tpass\x1b[201~')).toBe('\tif true:\n\t\tpass');
  });

  it('strips bracketed paste markers before submission and trims outer whitespace', () => {
    expect(cleanSubmitValue('\x1b[200~  hello world  \x1b[201~')).toBe('hello world');
  });

  it('finds the inserted segment for a paste in the middle of the input', () => {
    expect(findInputChange('hello world', 'hello brave new world')).toEqual({
      start: 6,
      removed: '',
      inserted: 'brave new ',
    });
  });

  it('does not ghost-complete slash command names anymore', () => {
    expect(tryGhostComplete('/pl', [{ cmd: '/plan' }, { cmd: '/help' }], ['claude'])).toBeNull();
  });

  it('still ghost-completes engine ids for /use', () => {
    expect(tryGhostComplete('/use cl', [{ cmd: '/use' }], ['claude', 'codex'])).toBe('aude');
  });

  it('ranks slash picker matches so /ap lands on /apply first', () => {
    expect(getSlashMatches('ap', [
      { cmd: '/cp' },
      { cmd: '/apply' },
      { cmd: '/map' },
    ]).map((cmd) => cmd.cmd)).toEqual(['/apply', '/map']);
  });

  it('moves slash picker selection with arrow keys with wrap-around', () => {
    expect(movePickerCursor('up', 0, 3)).toBe(2);
    expect(movePickerCursor('down', 0, 3)).toBe(1);
    expect(movePickerCursor('down', 2, 3)).toBe(0);
    expect(movePickerCursor('down', 0, 0)).toBe(0);
  });

  it('appends composer history with duplicate pruning and max length', () => {
    expect(appendInputHistory(['one', 'two'], 'one', 3)).toEqual(['two', 'one']);
    expect(appendInputHistory(['one', 'two', 'three'], 'four', 3)).toEqual(['two', 'three', 'four']);
    expect(appendInputHistory(['one'], '   ', 3)).toEqual(['one']);
  });

  it('parses first-class auto-mode controls without stealing /auto tasks', () => {
    expect(parseAutoModeCommand('/auto')).toBe('toggle');
    expect(parseAutoModeCommand('/auto on')).toBe('on');
    expect(parseAutoModeCommand('/autonomous off')).toBe('off');
    expect(parseAutoModeCommand('/auto status')).toBe('status');
    expect(parseAutoModeCommand('/auto fix login')).toBeNull();
  });

  it('parses first-class /mode controls without stealing unrelated input', () => {
    expect(parsePermissionModeCommand('/mode')).toBe('cycle');
    expect(parsePermissionModeCommand('/mode ask')).toBe('ask');
    expect(parsePermissionModeCommand('/mode auto-edit')).toBe('auto-edit');
    expect(parsePermissionModeCommand('/mode auto')).toBe('auto');
    expect(parsePermissionModeCommand('/mode status')).toBe('status');
    expect(parsePermissionModeCommand('/mode yolo')).toBeNull();
    expect(parsePermissionModeCommand('/models')).toBeNull();
  });

  it('allows /btw while a plan or background job is active even if the composer is idle', () => {
    expect(hasBtwSideChannelTarget({ replState: 'streaming', activePlanState: null, runningJobCount: 0 })).toBe(true);
    expect(hasBtwSideChannelTarget({ replState: 'idle', activePlanState: 'running', runningJobCount: 0 })).toBe(true);
    expect(hasBtwSideChannelTarget({ replState: 'idle', activePlanState: null, runningJobCount: 1 })).toBe(true);
    expect(hasBtwSideChannelTarget({ replState: 'idle', activePlanState: null, runningJobCount: 0 })).toBe(false);
  });
});

describe('processPasteContent', () => {
  it('preserves direct pasted formatting', () => {
    expect(processPasteContent('\tline1\n\tline2\n')).toEqual({
      type: 'direct',
      content: '\tline1\n\tline2\n',
    });
  });

  it('normalizes a lone CR to a newline so inline paste cannot overwrite the line start', () => {
    // A surviving \r does a literal carriage return at paint time: the cursor
    // jumps to column 0 and later text overwrites the start of the line.
    expect(processPasteContent('first half\rsecond half')).toEqual({
      type: 'direct',
      content: 'first half\nsecond half',
    });
    expect(processPasteContent('trailing\r')).toEqual({
      type: 'direct',
      content: 'trailing\n',
    });
    // CRLF still collapses to a single LF (no blank line in between).
    expect(processPasteContent('win\r\ndows')).toEqual({
      type: 'direct',
      content: 'win\ndows',
    });
  });

  it('strips ANSI escapes and stray control chars from inline pastes (copied log output)', () => {
    expect(processPasteContent('\x1b[32mOK\x1b[0m deploy done')).toEqual({
      type: 'direct',
      content: 'OK deploy done',
    });
    // C0 controls (bell, etc.) are dropped, but \t and \n are kept.
    expect(processPasteContent('a\x07b\tc\nd')).toEqual({
      type: 'direct',
      content: 'ab\tc\nd',
    });
  });

  it('stores very long pastes instead of inlining them', () => {
    vi.spyOn(pasteStore, 'store').mockReturnValue({
      hash: '0123456789abcdef',
      preview: 'x',
      lineCount: 1,
    });
    const longLine = 'x'.repeat(501);
    expect(processPasteContent(longLine)).toMatchObject({
      type: 'stored',
      placeholder: '[Pasted Content 501 chars]',
    });
  });

  it('expands codex-style paste placeholders by exact placeholder key', () => {
    vi.spyOn(pasteStore, 'retrieve').mockReturnValue('expanded text');
    const hashes = new Map([['[Pasted Content 501 chars]', '0123456789abcdef']]);

    expect(expandPastePlaceholders('before [Pasted Content 501 chars] after', hashes)).toBe('before expanded text after');
  });

  it('expands duplicate paste placeholders in insertion order', () => {
    vi.spyOn(pasteStore, 'retrieve')
      .mockReturnValueOnce('first paste')
      .mockReturnValueOnce('second paste');
    const hashes = new Map<string, string>();
    recordPastePlaceholder(hashes, '[Pasted Content 501 chars]', 'hash-one');
    recordPastePlaceholder(hashes, '[Pasted Content 501 chars]', 'hash-two');

    expect(expandPastePlaceholders('[Pasted Content 501 chars]\n[Pasted Content 501 chars]', hashes)).toBe('first paste\nsecond paste');
  });
});

describe('resolveEscapeAction', () => {
  it('interrupts active work on a single escape (empty composer)', () => {
    expect(resolveEscapeAction({
      replState: 'streaming',
      inputValue: '',
      slashPickerOpen: false,
      enginePickerOpen: false,
      questionOpen: false,
    })).toEqual({ action: 'interrupt' });
  });

  it('interrupt-submits when the composer holds a typed redirect (Claude-style esc)', () => {
    expect(resolveEscapeAction({
      replState: 'streaming',
      inputValue: 'do this instead',
      slashPickerOpen: false,
      enginePickerOpen: false,
      questionOpen: false,
    })).toEqual({ action: 'interrupt-submit' });
  });

  it('whitespace-only composer text still counts as a plain interrupt', () => {
    expect(resolveEscapeAction({
      replState: 'busy',
      inputValue: '   ',
      slashPickerOpen: false,
      enginePickerOpen: false,
      questionOpen: false,
    })).toEqual({ action: 'interrupt' });
  });

  it('interrupts a background job even after the foreground composer returned idle', () => {
    expect(resolveEscapeAction({
      replState: 'idle',
      runningJobCount: 1,
      inputValue: '',
      slashPickerOpen: false,
      enginePickerOpen: false,
      questionOpen: false,
    })).toEqual({ action: 'interrupt' });
  });

  it('still clears input on first escape while idle', () => {
    expect(resolveEscapeAction({
      replState: 'idle',
      inputValue: 'keep this short',
      slashPickerOpen: false,
      enginePickerOpen: false,
      questionOpen: false,
    })).toEqual({ action: 'clear-input' });
  });

  it('closes open pickers before applying global escape behavior', () => {
    expect(resolveEscapeAction({
      replState: 'streaming',
      inputValue: '',
      slashPickerOpen: true,
      enginePickerOpen: false,
      questionOpen: false,
    })).toEqual({ action: 'close-slash' });
  });

  it('does nothing while idle with empty input', () => {
    expect(resolveEscapeAction({
      replState: 'idle',
      inputValue: '',
      slashPickerOpen: false,
      enginePickerOpen: false,
      questionOpen: false,
    })).toEqual({ action: 'noop' });
  });
});

describe('shouldQueuePlanModeOnTab', () => {
  it('queues plan mode only when idle with an empty composer', () => {
    expect(shouldQueuePlanModeOnTab({
      replState: 'idle',
      inputValue: '',
      activePlanState: null,
    })).toBe(true);
  });

  it('does not queue plan mode when there is draft input', () => {
    expect(shouldQueuePlanModeOnTab({
      replState: 'idle',
      inputValue: 'draft task',
      activePlanState: null,
    })).toBe(false);
  });

  it('does not queue plan mode while another plan is already active', () => {
    expect(shouldQueuePlanModeOnTab({
      replState: 'idle',
      inputValue: '',
      activePlanState: 'planning',
    })).toBe(false);
  });
});
