import { describe, it, expect, vi } from 'vitest';

import { detectIntent } from '../../packages/cli/src/intent.js';
import { dispatchIntent } from '../../packages/cli/src/generated/signals/dispatch.js';
import { createBashTool } from '../../packages/core/src/generated/tools/tool-bash.js';
import { createEditTool } from '../../packages/core/src/generated/tools/tool-edit.js';
import { createWriteTool } from '../../packages/core/src/generated/tools/tool-write.js';

describe('Exploration Mode', () => {
  it('parses /explore aliases', () => {
    expect(detectIntent('/explore').type).toBe('explore');
    expect(detectIntent('/readonly').type).toBe('explore');
    expect(detectIntent('/plan-mode').type).toBe('explore');
  });

  it('resets Cesar session when exploration mode is toggled', async () => {
    const dispatch = vi.fn();
    const setExplorationMode = vi.fn();
    const setCesarSession = vi.fn();
    const close = vi.fn();

    const cb: any = {
      dispatch,
      ctx: {
        cesarSession: { close },
        setCesarSession,
        setExplorationMode,
      },
      runAsJob: vi.fn(),
      setMode: vi.fn(),
      setPendingImages: vi.fn(),
      setSessionEngines: vi.fn(),
      setEnginePickerOpen: vi.fn(),
      setChatSession: vi.fn(),
      setLastUndoToken: vi.fn(),
      askQuestion: vi.fn(),
      exit: vi.fn(),
      allImages: [],
      allSlashCommands: [],
      dynamicSkills: [],
      mode: 'chat',
      lastUndoToken: null,
      sessionStartTime: 0,
      jobManager: null,
      explorationMode: false,
      setExplorationMode,
    };

    const result = await dispatchIntent({ type: 'explore' }, '/explore', cb);

    expect(result).toEqual({ handled: true, ranAsJob: false });
    expect(setExplorationMode).toHaveBeenCalledWith(true);
    expect(close).toHaveBeenCalledOnce();
    expect(setCesarSession).toHaveBeenCalledWith(null);
    expect(dispatch).toHaveBeenCalledWith({
      type: 'info',
      message: 'Cesar session reset for exploration mode',
    });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'success',
      message: 'Exploration mode ON — read-only, write tools blocked. Use /explore again to disable.',
    });
  });

  it('allows only read-only bash commands in exploration mode', () => {
    const tool = createBashTool();
    const ctx: any = {
      cwd: '/tmp/project',
      readFileState: new Map(),
      explorationMode: true,
      permissionMode: 'auto',
    };

    expect(tool.checkPermission({ command: 'ls -la' }, ctx)).toEqual({ behavior: 'allow' });
    expect(tool.checkPermission({ command: 'npm test' }, ctx)).toEqual({ behavior: 'allow' });
    expect(tool.checkPermission({ command: 'npm install' }, ctx)).toEqual({
      behavior: 'deny',
      message: 'Bash blocked: exploration mode is active (read-only)',
      reason: 'exploration-mode',
    });
  });

  it('blocks edit and write tools in exploration mode', () => {
    const ctx: any = {
      cwd: '/tmp/project',
      readFileState: new Map(),
      explorationMode: true,
      permissionMode: 'auto',
    };

    expect(createEditTool().checkPermission({ file_path: 'src/app.ts', old_string: 'a', new_string: 'b' }, ctx)).toEqual({
      behavior: 'deny',
      message: 'Edit blocked: exploration mode is active (read-only)',
      reason: 'exploration-mode',
    });
    expect(createWriteTool().checkPermission({ file_path: 'src/app.ts', content: 'hello' }, ctx)).toEqual({
      behavior: 'deny',
      message: 'Write blocked: exploration mode is active (read-only)',
      reason: 'exploration-mode',
    });
  });
});
