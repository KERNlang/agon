import { afterEach, describe, expect, it } from 'vitest';

import {
  buildTranscriptRows,
  buildTerminalReplaySnapshot,
  coalesceToolCallBlocks,
  displayColumnToStringIndex,
  estimateBottomChromeExtraRows,
  estimateQuestionReservedRows,
  fileRailMaxRowsForTerminal,
  fileRailWidthForTerminal,
  findLatestToolDetailEvent,
  historyBlocksForTranscript,
  maxScrollOffsetForRowCount,
  nativeArchiveBlockCount,
  nativeTranscriptBlocksForStatic,
  normalizeTerminalMode,
  nextWheelAnimationStep,
  stringDisplayWidth,
  transcriptRowsToPlainText,
} from '../../packages/cli/src/generated/surfaces/app.js';
import { cleanupTestAgonHome } from '../helpers/agon-home.js';

let testHome: string | undefined;

afterEach(() => {
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

  it('hides the idle-only native dashboard, then keeps it once chat starts', () => {
    const dashboardOnly = [
      { id: 0, event: { type: 'dashboard', available: [], enabled: [], defaultEngine: 'claude', totalForges: 0, runCount: 0 } },
    ] as any;
    const blocks = [
      { id: 0, event: { type: 'dashboard', available: [], enabled: [], defaultEngine: 'claude', totalForges: 0, runCount: 0 } },
      { id: 1, event: { type: 'separator' } },
      { id: 2, event: { type: 'user-message', content: 'hello' } },
    ] as any;

    expect(nativeTranscriptBlocksForStatic(dashboardOnly)).toEqual([]);
    expect(nativeTranscriptBlocksForStatic(blocks).map((block: any) => block.event.type)).toEqual(['dashboard', 'separator', 'user-message']);
  });

  it('archives old native transcript blocks while keeping the recent tail live', () => {
    const blocks = Array.from({ length: 5 }, (_, index) => ({
      id: index + 1,
      event: { type: 'separator' },
    })) as any;

    expect(nativeArchiveBlockCount(blocks, 'chat', 2, false, true)).toBe(3);
  });

  it('archives a native block immediately when it cannot fit in the live row budget', () => {
    const blocks = [
      {
        id: 1,
        event: {
          type: 'engine-block',
          engineId: 'cesar',
          color: 124,
          content: Array.from({ length: 12 }, (_, index) => `line ${index + 1}`).join('\n'),
        },
      },
    ] as any;

    expect(nativeArchiveBlockCount(blocks, 'chat', 3, false, true)).toBe(1);
  });

  it('defaults unknown terminal mode values to native scrollback', () => {
    expect(normalizeTerminalMode(undefined)).toBe('native');
    expect(normalizeTerminalMode('native')).toBe('native');
    expect(normalizeTerminalMode('fullscreen')).toBe('fullscreen');
  });

  it('keeps the file rail compact on wide native terminals', () => {
    expect(fileRailWidthForTerminal(220, false)).toBe(42);
    expect(fileRailWidthForTerminal(220, true)).toBeLessThanOrEqual(64);
    expect(fileRailMaxRowsForTerminal(80, 'native', false)).toBe(10);
    expect(fileRailMaxRowsForTerminal(80, 'native', true)).toBe(18);
  });

  it('replays terminal render snapshots across native and fullscreen sizes', () => {
    const blocks = [
      { id: 0, event: { type: 'dashboard', available: [], enabled: ['claude'], defaultEngine: 'claude', totalForges: 0, runCount: 0 } },
      { id: 1, event: { type: 'separator' } },
      { id: 2, event: { type: 'user-message', content: 'check api engines and render stability' } },
      {
        id: 3,
        event: {
          type: 'engine-block',
          engineId: 'cesar',
          color: 124,
          content: Array.from({ length: 18 }, (_, index) => `render line ${index + 1}`).join('\n'),
        },
      },
      { id: 4, event: { type: 'tool-call', engineId: 'cesar', tool: 'Read', input: '{"file_path":"packages/cli/src/kern/surfaces/app.kern"}', status: 'done', output: 'line 1\nline 2\nline 3' } },
    ] as any;

    const snapshots = [
      buildTerminalReplaySnapshot(blocks, { terminalMode: 'native', mode: 'chat', termWidth: 72, termHeight: 24, fileRailOpen: false }),
      buildTerminalReplaySnapshot(blocks, { terminalMode: 'native', mode: 'chat', termWidth: 220, termHeight: 80, fileRailOpen: true }),
      buildTerminalReplaySnapshot(blocks, { terminalMode: 'fullscreen', mode: 'chat', termWidth: 120, termHeight: 36, fileRailOpen: true, fileRailExpanded: true }),
    ];

    for (const snapshot of snapshots) {
      expect(snapshot.headerRows).toBe(1);
      expect(snapshot.visibleBudget).toBeGreaterThan(0);
      expect(snapshot.lowerChromeRows).toBeLessThan(snapshot.termHeight);
      expect(snapshot.transcriptRowCount).toBeGreaterThan(0);
      expect(snapshot.fileRailRows).toBeLessThanOrEqual(snapshot.termHeight - snapshot.headerRows);
      expect(snapshot.fileRailWidth).toBeLessThanOrEqual(Math.floor(snapshot.termWidth * 0.35));
    }

    expect(snapshots[0].staticBlockCount).toBeGreaterThan(0);
    expect(snapshots[2].staticBlockCount).toBe(0);
  });

  it('replays transcript wrapping with the supplied terminal width', () => {
    const blocks = [
      {
        id: 1,
        event: {
          type: 'engine-block',
          engineId: 'cesar',
          color: 124,
          content: 'This is one intentionally long render line that must wrap differently when replayed at a narrow terminal width versus a wide terminal width.',
        },
      },
    ] as any;

    const narrow = buildTerminalReplaySnapshot(blocks, { terminalMode: 'fullscreen', mode: 'chat', termWidth: 72, termHeight: 24 });
    const wide = buildTerminalReplaySnapshot(blocks, { terminalMode: 'fullscreen', mode: 'chat', termWidth: 180, termHeight: 24 });

    expect(narrow.transcriptRowCount).toBeGreaterThan(wide.transcriptRowCount);
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

  it('renders collapsed tool telemetry like thinking and hides raw confidence JSON previews', () => {
    const blocks = [
      { id: 1, event: { type: 'tool-call', engineId: 'cesar', tool: 'ReportConfidence', input: '{"value":45,"reasoning":"inspect first"}', status: 'done', output: 'ok' } },
      { id: 2, event: { type: 'tool-call', engineId: 'cesar', tool: 'Bash', input: '{"command":"git log --oneline -20"}', status: 'done', output: 'abc' } },
      { id: 3, event: { type: 'tool-call', engineId: 'cesar', tool: 'Glob', input: '{"pattern":"**/cesar/**"}', status: 'done', output: 'file' } },
    ] as any;

    const rows = buildTranscriptRows(blocks, 'chat', false, true);
    const summaryRow = rows.find((row: any) => row.key.includes('tool-group-head'));
    const text = transcriptRowsToPlainText(rows, 0, 0, 999, 999);

    expect(summaryRow).toBeTruthy();
    expect(summaryRow.segments[0]).toMatchObject({ italic: true, dimColor: true });
    expect(text).toContain('▹ 3 tool calls');
    expect(text).toContain('Confidence');
    expect(text).not.toContain('⏿');
    expect(text).not.toContain('"reasoning"');
    expect(text).not.toContain('{"value"');
  });

  it('renders Cesar route info as dim italic telemetry', () => {
    const rows = buildTranscriptRows([
      { id: 1, event: { type: 'info', message: 'Cesar route: big-feature -> plan-first | kimi/api | tools: watch' } },
    ] as any, 'chat', false, true);

    const infoRow = rows.find((row: any) => row.key.includes('info'));
    expect(infoRow?.segments[0]).toMatchObject({ italic: true, dimColor: true, color: '#8b8b8b' });
  });

  it('renders all thinking lines now that thinking is always visible', () => {
    const rows = buildTranscriptRows([
      { id: 1, event: { type: 'thinking-chunk', engineId: 'cesar', chunk: 'one\ntwo\nthree\nfour\nfive' } },
    ] as any, 'chat', false, true);
    const text = transcriptRowsToPlainText(rows, 0, 0, 999, 999);

    expect(text).toContain('▹ five');
    expect(text).not.toContain('more lines');
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

  it('keeps edit previews compact in the transcript without dead shortcut hints', () => {
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
      row.kind === 'segments' && (row.segments ?? []).some((segment: any) => /more .* lines/.test(String(segment?.text ?? ''))),
    )).toBe(true);
    const text = transcriptRowsToPlainText(rows, 0, 0, 0, 999);
    expect(text).not.toContain('Ctrl+O');
  });

  it('coalesces consecutive collapsed tool-call groups into one transcript row', () => {
    const blocks = [
      {
        id: 1,
        event: {
          type: 'tool-call-group',
          blocks: [
            { id: 11, event: { type: 'tool-call', engineId: 'cesar', tool: 'Bash', input: '{"command":"pwd"}', status: 'done', output: '/tmp' } },
          ],
        },
      },
      {
        id: 2,
        event: {
          type: 'tool-call-group',
          blocks: [
            { id: 21, event: { type: 'tool-call', engineId: 'cesar', tool: 'Read', input: '{"file_path":"a.ts"}', status: 'done', output: 'line 1' } },
            { id: 22, event: { type: 'tool-call', engineId: 'cesar', tool: 'Bash', input: '{"command":"git status"}', status: 'done', output: '' } },
          ],
        },
      },
    ] as any;

    const rows = buildTranscriptRows(blocks, 'chat', false, true);
    const text = transcriptRowsToPlainText(rows, 0, 0, 0, 999);

    expect(text).toContain('3 tool calls');
    expect(text).not.toContain('1 tool calls');
    expect(text).not.toContain('2 tool calls');
  });

  it('coalesces adjacent tool-call blocks before native Static rendering', () => {
    const blocks = [
      {
        id: 1,
        event: {
          type: 'tool-call-group',
          blocks: [
            { id: 11, event: { type: 'tool-call', engineId: 'cesar', tool: 'ReportConfidence', input: '{"value":70}', status: 'done', output: 'ok' } },
          ],
        },
      },
      {
        id: 2,
        event: {
          type: 'tool-call-group',
          blocks: [
            { id: 21, event: { type: 'tool-call', engineId: 'cesar', tool: 'Grep', input: '{"pattern":"TODO"}', status: 'done', output: 'TODO' } },
            { id: 22, event: { type: 'tool-call', engineId: 'cesar', tool: 'Read', input: '{"file_path":"a.ts"}', status: 'done', output: 'line 1' } },
          ],
        },
      },
      { id: 3, event: { type: 'engine-block', engineId: 'cesar', color: 124, content: 'done' } },
    ] as any;

    const coalesced = coalesceToolCallBlocks(blocks);

    expect(coalesced).toHaveLength(2);
    expect(coalesced[0].event.type).toBe('tool-call-group');
    expect((coalesced[0].event as any).blocks).toHaveLength(3);
  });

  it('keeps read/search-only collapsed groups to one quiet summary row', () => {
    const blocks = [
      {
        id: 1,
        event: {
          type: 'tool-call-group',
          blocks: [
            { id: 11, event: { type: 'tool-call', engineId: 'cesar', tool: 'Read', input: '{"file_path":"README.md"}', status: 'done', output: 'readme' } },
            { id: 12, event: { type: 'tool-call', engineId: 'cesar', tool: 'Grep', input: '{"pattern":"TODO"}', status: 'done', output: 'TODO' } },
            { id: 13, event: { type: 'tool-call', engineId: 'cesar', tool: 'Read', input: '{"file_path":"package.json"}', status: 'done', output: '{}' } },
          ],
        },
      },
    ] as any;

    const rows = buildTranscriptRows(blocks, 'chat', false, true);
    const text = transcriptRowsToPlainText(rows, 0, 0, 0, 999);

    expect(rows).toHaveLength(1);
    expect(text).toContain('3 tool calls');
    expect(text).toContain('Read×2');
    expect(text).toContain('Search');
    expect(text).not.toContain('changed');
    expect(text).not.toContain('[Ctrl+O] Open');
    expect(text).not.toContain('README.md');
    expect(text).not.toContain('package.json');
  });

  it('always shows mutating code-change previews inside collapsed tool-call groups', () => {
    const blocks = [
      {
        id: 1,
        event: {
          type: 'tool-call-group',
          blocks: [
            {
              id: 11,
              event: {
                type: 'tool-call',
                engineId: 'cesar',
                tool: 'Edit',
                input: JSON.stringify({
                  file_path: 'packages/cli/src/kern/surfaces/app.kern',
                  old_string: 'old line',
                  new_string: 'new line',
                }),
                status: 'done',
              },
            },
          ],
        },
      },
    ] as any;

    const rows = buildTranscriptRows(blocks, 'chat', false, true);
    const text = transcriptRowsToPlainText(rows, 0, 0, 0, 999);

    expect(text).toContain('changed 1 file: packages/cli/src/kern/surfaces/app.kern');
    expect(text).not.toContain('[Ctrl+O] Open');
    expect(rows.some((row: any) => row.kind === 'diff' && row.text === '-old line')).toBe(true);
    expect(rows.some((row: any) => row.kind === 'diff' && row.text === '+new line')).toBe(true);
  });

  it('shows MCP AgonEdit previews inside collapsed tool-call groups', () => {
    const blocks = [
      {
        id: 1,
        event: {
          type: 'tool-call-group',
          blocks: [
            {
              id: 11,
              event: {
                type: 'tool-call',
                engineId: 'cesar',
                tool: 'AgonEdit',
                input: JSON.stringify({
                  file_path: 'packages/cli/src/kern/cesar/session.kern',
                  old_string: 'old mcp',
                  new_string: 'new mcp',
                }),
                status: 'done',
              },
            },
          ],
        },
      },
    ] as any;

    const rows = buildTranscriptRows(blocks, 'chat', false, true);
    const text = transcriptRowsToPlainText(rows, 0, 0, 0, 999);

    expect(text).toContain('changed 1 file: packages/cli/src/kern/cesar/session.kern');
    expect(text).not.toContain('[Ctrl+O] Open');
    expect(rows.some((row: any) => row.kind === 'diff' && row.text === '-old mcp')).toBe(true);
    expect(rows.some((row: any) => row.kind === 'diff' && row.text === '+new mcp')).toBe(true);
  });

  it('shows patch-tool changes inside collapsed tool-call groups', () => {
    const blocks = [
      {
        id: 1,
        event: {
          type: 'tool-call-group',
          blocks: [
            {
              id: 11,
              event: {
                type: 'tool-call',
                engineId: 'cesar',
                tool: 'apply_patch',
                input: [
                  '*** Begin Patch',
                  '*** Update File: packages/cli/src/kern/blocks/file-rail.kern',
                  '@@',
                  '-old rail',
                  '+new rail',
                  '*** End Patch',
                ].join('\n'),
                status: 'done',
              },
            },
          ],
        },
      },
    ] as any;

    const rows = buildTranscriptRows(blocks, 'chat', false, true);
    const text = transcriptRowsToPlainText(rows, 0, 0, 0, 999);

    expect(text).toContain('changed 1 file: packages/cli/src/kern/blocks/file-rail.kern');
    expect(text).not.toContain('[Ctrl+O] Open');
    expect(rows.some((row: any) => row.kind === 'diff' && row.text === '-old rail')).toBe(true);
    expect(rows.some((row: any) => row.kind === 'diff' && row.text === '+new rail')).toBe(true);
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
