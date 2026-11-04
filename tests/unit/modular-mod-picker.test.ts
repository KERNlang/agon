import React from 'react';
import { render } from 'ink';
import { describe, expect, it, vi } from 'vitest';
import { createFirstPartyModCatalog, createFullCompatDesiredState, createModManagementView } from '../../packages/mod-kernel/src/index.js';
import { ModManagementPicker } from '../../packages/cli/src/blocks/controls.js';
import { createPseudoTty, stripTerminalControl } from '../../packages/cli/src/blocks/frame-capture.js';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const frame = (tty: ReturnType<typeof createPseudoTty>) => stripTerminalControl(tty.lastFrame());

describe('mod management picker', () => {
  it('renders grouped status/recovery and supports arrows, Home, End, and Escape through the real Ink input path', async () => {
    const catalog = createFirstPartyModCatalog();
    const desired = createFullCompatDesiredState(catalog, '2026-09-04T00:00:00.000Z');
    const blockedId = catalog.mods[1]!.modId;
    const view = createModManagementView(catalog, desired, { availability: { [blockedId]: {
      code: 'activation-failed', message: 'activation failed safely', recovery: 'Run agon doctor mods, disable it, then restart.',
    } } });
    const entries = view.groups.flatMap(({ entries }) => entries); const tty = createPseudoTty(120, 60); const onClose = vi.fn();
    const app = render(React.createElement(ModManagementPicker as any, { view, onClose }), {
      stdout: tty.stdout as any, stderr: tty.stderr as any, stdin: tty.stdin as any, debug: true, exitOnCtrlC: false, patchConsole: false,
    });
    await sleep(30); expect(frame(tty)).toContain(view.groups[0]!.label); expect(frame(tty)).toContain('Recovery:');
    tty.stdin.write('\x1b[B'); await sleep(30); expect(frame(tty)).toContain(`› [${entries[1]!.status}] ${entries[1]!.label}`);
    tty.stdin.write('\x1b[F'); await sleep(30); expect(frame(tty)).toContain(`› [${entries.at(-1)!.status}] ${entries.at(-1)!.label}`);
    tty.stdin.write('\x1b[H'); await sleep(30); expect(frame(tty)).toContain(`› [${entries[0]!.status}] ${entries[0]!.label}`);
    tty.stdin.write('\x1b'); await sleep(30); expect(onClose).toHaveBeenCalledOnce(); app.unmount();
  });
});
