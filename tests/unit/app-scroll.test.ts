import { afterEach, describe, expect, it } from 'vitest';
import { configSet } from '@agon/core';

import {
  buildTranscriptRows,
  displayColumnToStringIndex,
  estimateBottomChromeExtraRows,
  estimateQuestionReservedRows,
  findLatestToolDetailEvent,
  historyBlocksForTranscript,
  isFullscreenEnabled,
  isMouseTrackingEnabled,
  maxScrollOffsetForRowCount,
  nextWheelAnimationStep,
  resetViewportSequence,
  stringDisplayWidth,
  transcriptRowsToPlainText,
} from '../../packages/cli/src/generated/surfaces/app.js';
import { buildHistoryScrollbarCells } from '../../packages/cli/src/generated/surfaces/app-views.js';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

const TERMINAL_ENV_KEYS = [
  'AGON_DISABLE_FULLSCREEN',
  'AGON_NATIVE_TERMINAL',
  'AGON_FULLSCREEN',
  'AGON_ALT_SCREEN',
  'AGON_DISABLE_MOUSE',
  'AGON_DISABLE_MOUSE_SCROLL',
  'AGON_ENABLE_MOUSE_SCROLL',
];

let testHome: string | undefined;

afterEach(() => {
  for (const key of TERMINAL_ENV_KEYS) delete process.env[key];
  cleanupTestAgonHome(testHome);
  testHome = undefined;
});

describe('app scroll helpers', () => {
  it('does not allow scroll when every rendered row fits in the viewport budget', () => {
    expect(maxScrollOffsetForRowCount(3, 10)).toBe(0);
    expect(maxScrollOffsetForRowCount(1, 1)).toBe(0);
  });

  it('only allows scrolling by the overflow beyond the visible row budget', () => {
    expect(maxScrollOffsetForRowCount(12, 5)).toBe(7);
  });

  it('consumes large wheel bursts over a few animation steps instead of one jump', () => {
    expect(nextWheelAnimationStep(1)).toEqual({ step: 1, remaining: 0 });
    expect(nextWheelAnimationStep(4)).toEqual({ step: 2, remaining: 2 });
    expect(nextWheelAnimationStep(-7)).toEqual({ step: -4, remaining: -3 });
    expect(nextWheelAnimationStep(18)).toEqual({ step: 6, remaining: 12 });
  });

  it('builds a persistent history scrollbar thumb for the visible viewport', () => {
    expect(buildHistoryScrollbarCells(0, 5, 0)).toEqual([]);
    expect(buildHistoryScrollbarCells(0, 5, 10)).toEqual(['thumb', 'thumb', 'track', 'track', 'track']);
    expect(buildHistoryScrollbarCells(5, 5, 5)).toEqual(['track', 'track', 'thumb', 'thumb', 'track']);
    expect(buildHistoryScrollbarCells(10, 5, 0)).toEqual(['track', 'track', 'track', 'thumb', 'thumb']);
  });

  it('resets the native viewport without clearing scrollback', () => {
    expect(resetViewportSequence()).toBe('\x1b[2J\x1b[H');
  });

  it('defaults to fullscreen app scroll and lets config opt into native terminal scrolling', () => {
    testHome = setupTestAgonHome('app-scroll-terminal-mode');

    expect(isFullscreenEnabled()).toBe(true);
    expect(isMouseTrackingEnabled()).toBe(true);

    configSet('terminalMode', 'native' as any);

    expect(isFullscreenEnabled()).toBe(false);
    expect(isMouseTrackingEnabled()).toBe(false);
  });

  it('lets env vars override terminal mode and mouse capture', () => {
    testHome = setupTestAgonHome('app-scroll-terminal-mode-env');
    configSet('terminalMode', 'fullscreen' as any);

    process.env.AGON_ALT_SCREEN = '0';
    expect(isFullscreenEnabled()).toBe(false);
    expect(isMouseTrackingEnabled()).toBe(false);

    delete process.env.AGON_ALT_SCREEN;
    configSet('terminalMode', 'native' as any);
    process.env.AGON_ENABLE_MOUSE_SCROLL = '1';
    expect(isMouseTrackingEnabled()).toBe(true);
  });

  it('keeps the startup dashboard hidden while idle and preserves it once real chat exists', () => {
    const dashboardOnly = [
      { id: 0, event: { type: 'dashboard', available: [], enabled: [], defaultEngine: 'claude', totalForges: 0, runCount: 0 } },
    ] as any;
    const mixed = [
      { id: 0, event: { type: 'dashboard', available: [], enabled: [], defaultEngine: 'claude', totalForges: 0, runCount: 0 } },
      { id: 1, event: { type: 'user-message', content: 'hello' } },
    ] as any;

    expect(historyBlocksForTranscript(dashboardOnly)).toEqual([]);
    expect(historyBlocksForTranscript(mixed).map((block: any) => block.event.type)).toEqual(['dashboard', 'user-message']);
  });

  it('renders the dashboard through transcript rows when it is the only visible block', () => {
    const dashboardOnly = [
      {
        id: 0,
        event: {
          type: 'dashboard',
          available: [],
          enabled: ['claude', 'codex'],
          defaultEngine: 'claude',
          totalForges: 0,
          runCount: 0,
          eloTop: { id: 'claude', rating: 1492 },
        },
      },
    ] as any;

    const rows = buildTranscriptRows(dashboardOnly, 'chat', false, true);

    expect(rows.some((row: any) => row.kind === 'gradient')).toBe(true);
    expect(rows.some((row: any) => row.key.includes('dash-engines'))).toBe(true);
  });

  it('groups consecutive collapsed tool calls into an explicit summary block', () => {
    const blocks = [
      { id: 1, event: { type: 'tool-call', engineId: 'cesar', tool: 'Bash', input: '{"command":"pwd"}', status: 'done', output: '/tmp' } },
      { id: 2, event: { type: 'tool-call', engineId: 'cesar', tool: 'Grep', input: '{"pattern":"x"}', status: 'done', output: 'x' } },
      { id: 3, event: { type: 'tool-call', engineId: 'cesar', tool: 'Glob', input: '{"pattern":"*.ts"}', status: 'done', output: 'a.ts' } },
    ] as any;

    const rows = buildTranscriptRows(blocks, 'chat', false, true);
    const summaryRow = rows.find((row: any) => row.key.includes('tool-group-head'));
    const previewRow = rows.find((row: any) => row.key.includes('tool-group-preview'));

    expect(summaryRow).toBeTruthy();
    expect(previewRow).toBeTruthy();
  });

  it('renders permission requests as compact transcript rows', () => {
    const rows = buildTranscriptRows([
      {
        id: 1,
        event: {
          type: 'permission-ask',
          tool: 'Bash',
          command: 'npm install some-package --save-dev',
          reason: 'needs approval',
          resolve: () => {},
        },
      },
    ] as any, 'chat', false, true);

    expect(rows.some((row: any) => row.key.includes('perm-head'))).toBe(true);
    expect(rows.some((row: any) => row.key.includes('perm-actions'))).toBe(true);
    expect(rows.some((row: any) => row.key.includes('perm-cmd'))).toBe(true);
    expect(rows.length).toBeLessThanOrEqual(3);
  });

  it('reserves extra viewport rows while a permission prompt is open', () => {
    expect(estimateQuestionReservedRows(null, 100)).toBe(0);
    expect(estimateQuestionReservedRows({ kind: 'permission', command: 'npm test', choices: [] }, 100)).toBe(3);
    expect(
      estimateQuestionReservedRows(
        {
          kind: 'permission',
          command: 'cd /repo && kern compile packages/core/src/kern/signals/cli-models-registry.kern --outdir=packages/core/src/generated/signals',
          reason: 'needs approval',
          choices: [{ key: 'y' }, { key: 'n' }, { key: 'a' }],
        },
        60,
      ),
    ).toBe(4);
  });

  it('reserves enough rows for generic yes/no questions so choices do not clip', () => {
    expect(
      estimateQuestionReservedRows(
        {
          prompt: 'Want me to commit and push it?',
          choices: [{ key: 'y', label: 'Yes' }, { key: 'n', label: 'No' }],
        },
        100,
      ),
    ).toBe(2);
  });

  it('accounts for wrapped prompt and choice labels in generic question cards', () => {
    expect(
      estimateQuestionReservedRows(
        {
          prompt: 'This is a deliberately long confirmation prompt that should wrap on a narrow terminal before the choices render underneath it.',
          choices: [
            { key: 'y', label: 'Yes, commit and push the generated script' },
            { key: 'n', label: 'No, leave it uncommitted for now' },
          ],
        },
        44,
      ),
    ).toBeGreaterThanOrEqual(5);
  });

  it('reserves an extra input row for freeform questions after the prompt', () => {
    expect(
      estimateQuestionReservedRows(
        { prompt: 'Project name?' },
        80,
      ),
    ).toBe(2);
  });

  it('counts queued badges and chat spinner rows in the bottom chrome budget', () => {
    expect(estimateBottomChromeExtraRows('chat', null, 100, 1, 1, true)).toBe(3);
    expect(
      estimateBottomChromeExtraRows(
        'chat',
        {
          prompt: 'Want me to commit and push it?',
          choices: [{ key: 'y', label: 'Yes' }, { key: 'n', label: 'No' }],
        },
        100,
        0,
        0,
        true,
      ),
    ).toBe(2);
  });

  it('treats expanded bash output as multi-row transcript history', () => {
    const block = {
      id: 1,
      event: {
        type: 'tool-call',
        engineId: 'cesar',
        tool: 'Bash',
        input: '{"command":"git diff --stat HEAD 2>/dev/null | head -20"}',
        status: 'done',
        output: Array.from({ length: 20 }, (_, index) => `line ${index + 1}`).join('\n'),
      },
    } as any;

    const rows = buildTranscriptRows([block], 'chat', true, true);

    expect(rows.length).toBeGreaterThan(10);
    expect(rows.some((row: any) => row.kind === 'ansi')).toBe(true);
  });

  it('renders read/search/find tool previews when tools are expanded', () => {
    const blocks = [
      {
        id: 1,
        event: {
          type: 'tool-call',
          engineId: 'cesar',
          tool: 'Read',
          input: '{"file_path":"packages/cli/src/handlers/models.ts"}',
          status: 'done',
          output: 'line 1\nline 2\nline 3\nline 4',
        },
      },
      {
        id: 2,
        event: {
          type: 'tool-call',
          engineId: 'cesar',
          tool: 'Search',
          input: '{"pattern":"modelPicker","path":"packages/cli/src"}',
          status: 'done',
          output: 'app.tsx:12:modelPicker\napp.tsx:42:modelPicker',
        },
      },
      {
        id: 3,
        event: {
          type: 'tool-call',
          engineId: 'cesar',
          tool: 'Find',
          input: '{"pattern":"*.ts"}',
          status: 'done',
          output: 'a.ts\nb.ts\nc.ts',
        },
      },
    ] as any;

    const collapsedRows = buildTranscriptRows(blocks, 'chat', false, true);
    const expandedRows = buildTranscriptRows(blocks, 'chat', true, true);

    expect(expandedRows.length).toBeGreaterThan(collapsedRows.length);
    expect(expandedRows.some((row: any) => row.key.includes('-read-'))).toBe(true);
    expect(expandedRows.some((row: any) => row.key.includes('-search-'))).toBe(true);
    expect(expandedRows.some((row: any) => row.key.includes('find-file-'))).toBe(true);
  });

  it('keeps edit previews compact in the transcript and points large changes to the focused viewer', () => {
    const block = {
      id: 1,
      event: {
        type: 'tool-call',
        engineId: 'cesar',
        tool: 'Update',
        input: JSON.stringify({
          file_path: 'packages/cli/src/app.ts',
          old_string: Array.from({ length: 8 }, (_, index) => `old ${index + 1}`).join('\n'),
          new_string: Array.from({ length: 9 }, (_, index) => `new ${index + 1}`).join('\n'),
        }),
        status: 'done',
      },
    } as any;

    const rows = buildTranscriptRows([block], 'chat', false, true);

    expect(rows.some((row: any) => row.kind === 'diff')).toBe(true);
    expect(rows.some((row: any) =>
      row.kind === 'segments' && (row.segments ?? []).some((segment: any) => segment?.text === 'Ctrl+O full view'),
    )).toBe(true);
  });

  it('finds the latest approval command or large tool output for the focused viewer', () => {
    const blocks = [
      { id: 1, event: { type: 'tool-call', engineId: 'cesar', tool: 'Read', input: '{"file_path":"a.ts"}', status: 'done', output: 'line 1' } },
      {
        id: 2,
        event: {
          type: 'permission-ask',
          tool: 'Bash',
          command: 'npm run build\nnpm test\nnpm run lint\nnpm run typecheck\nnpm run release',
          reason: 'needs approval',
        },
      },
    ] as any;

    expect(findLatestToolDetailEvent(blocks)).toEqual(blocks[1].event);
  });

  it('turns selected transcript rows back into plain text for clipboard copy', () => {
    const rows = buildTranscriptRows([
      { id: 1, event: { type: 'user-message', content: 'hello world' } },
      { id: 2, event: { type: 'info', message: 'queued' } },
      { id: 3, event: { type: 'dashboard', available: [], enabled: ['claude'], defaultEngine: 'claude', totalForges: 0, runCount: 0 } },
    ] as any, 'chat', false, true);

    expect(transcriptRowsToPlainText(rows, 0, 0, 1, 999)).toContain('hello world');
    expect(transcriptRowsToPlainText(rows, 0, 0, 1, 999)).toContain('queued');
  });

  it('supports character-precise clipboard slices across selected transcript rows', () => {
    const rows = [
      { key: 'row-1', kind: 'ansi', prefixText: '', text: 'hello world' },
      { key: 'row-2', kind: 'ansi', prefixText: '', text: 'queued now' },
    ] as any;

    expect(transcriptRowsToPlainText(rows, 0, 6, 0, 11)).toBe('world');
    expect(transcriptRowsToPlainText(rows, 0, 6, 1, 6)).toBe('world\nqueued');
  });

  it('maps mouse columns through wide characters by display width, not code units', () => {
    expect(stringDisplayWidth('a界b')).toBe(4);
    expect(displayColumnToStringIndex('a界b', 0)).toBe(0);
    expect(displayColumnToStringIndex('a界b', 1)).toBe(1);
    expect(displayColumnToStringIndex('a界b', 2)).toBe(1);
    expect(displayColumnToStringIndex('a界b', 3)).toBe(2);
    expect(displayColumnToStringIndex('a界b', 4)).toBe(3);
    expect(displayColumnToStringIndex('a🙂b', 2)).toBe(1);
    expect(displayColumnToStringIndex('a🙂b', 3)).toBe(3);
  });
});
