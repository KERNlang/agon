import React, { act } from 'react';
import { render } from 'ink';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPseudoTty } from '../../packages/cli/src/blocks/frame-capture.js';
import { createComposerInputStore } from '../../packages/cli/src/signals/composer-input-store.js';

const observed = vi.hoisted(() => ({ composer: vi.fn(), strip: vi.fn() }));
vi.mock('../../packages/cli/src/blocks/composer.js', () => ({
  ComposerView: (props: unknown) => { observed.composer(props); return null; },
}));
vi.mock('../../packages/cli/src/surfaces/status.js', () => ({
  CesarStatusStrip: (props: unknown) => { observed.strip(props); return null; },
  StatusBar: () => null,
  StatusDashboard: () => null,
  ExecutionRailPanel: () => null,
}));

import { BottomChromeSection } from '../../packages/cli/src/surfaces/app-views.js';

describe('bottom chrome typing pause', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it('pauses cosmetic updates locally, extends the pause, and restores the latest snippet', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const schedule = vi.spyOn(globalThis, 'setTimeout');
    const cancel = vi.spyOn(globalThis, 'clearTimeout');
    const tty = createPseudoTty(80, 24);
    const onChange = vi.fn();
    const props = {
      pendingImages: [], inputQueue: [], runningJobs: [], replState: 'streaming',
      mode: 'brainstorm', activePlan: null, composerInput: createComposerInputStore(),
      handleInputChange: onChange, termWidth: 80, termHeight: 24,
      streamSnippet: { engineId: 'fixture', line: 'first' },
    };
    let app!: ReturnType<typeof render>;
    await act(async () => {
      app = render(React.createElement(BottomChromeSection, props as any), {
        stdout: tty.stdout as any, stderr: tty.stderr as any, stdin: tty.stdin as any,
        debug: true, exitOnCtrlC: false, patchConsole: false,
      });
    });
    const strip = () => observed.strip.mock.lastCall![0];
    const change = (value: string) => observed.composer.mock.lastCall![0].handleInputChange(value);
    try {
      await vi.advanceTimersByTimeAsync(1);
      expect(strip().streamSnippet).toEqual(props.streamSnippet);
      await act(async () => { change('a'); });
      expect(onChange).toHaveBeenLastCalledWith('a');
      expect(strip().interactionActive).toBe(true);
      expect(strip().streamSnippet).toBeNull();
      await vi.advanceTimersByTimeAsync(200);
      await act(async () => { change('ab'); });
      const nextSnippet = { engineId: 'fixture', line: 'new output' };
      const nextOnChange = vi.fn();
      await act(async () => {
        app.rerender(React.createElement(BottomChromeSection, {
          ...props, streamSnippet: nextSnippet, handleInputChange: nextOnChange,
        } as any));
      });
      await vi.advanceTimersByTimeAsync(200);
      expect(strip().interactionActive).toBe(true);
      expect(strip().streamSnippet).toBeNull();
      await act(async () => { await vi.advanceTimersByTimeAsync(151); });
      expect(strip().interactionActive).toBe(false);
      expect(strip().streamSnippet).toEqual(nextSnippet);
      expect(onChange.mock.calls).toEqual([['a'], ['ab']]);
      await act(async () => { change('abc'); });
      expect(nextOnChange.mock.calls).toEqual([['abc']]);
      expect(onChange.mock.calls).toEqual([['a'], ['ab']]);
      const pauseIndex = schedule.mock.calls.findLastIndex((call) => call[1] === 350);
      expect(pauseIndex).toBeGreaterThanOrEqual(0);
      const pendingPause = schedule.mock.results[pauseIndex].value;
      cancel.mockClear();
      await act(async () => { app.unmount(); });
      expect(cancel).toHaveBeenCalledWith(pendingPause);
      const renderCount = observed.strip.mock.calls.length;
      await vi.advanceTimersByTimeAsync(400);
      expect(observed.strip).toHaveBeenCalledTimes(renderCount);
    } finally {
      await act(async () => { app.unmount(); });
    }
  });
});
