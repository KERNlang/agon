import { spawnWithTimeout } from '@agon/core';

import type { Dispatch, HandlerContext } from '../handlers/types.js';

export async function handleRun(command: string, dispatch: Dispatch, ctx: HandlerContext): Promise<void> {
  if (!command.trim()) {
    dispatch({ type: 'error', message: 'Usage: /run <command>' });
    return;
  }
  
  dispatch({ type: 'spinner-start', message: `Running: ${command.slice(0, 60)}` });
  
  try {
    const result = await spawnWithTimeout({
      command: '/bin/sh',
      args: ['-c', command],
      cwd: process.cwd(),
      timeout: 60000,
    });
  
    dispatch({ type: 'spinner-stop' });
  
    if (result.stdout.trim()) {
      dispatch({ type: 'text', content: result.stdout.trim() });
    }
    if (result.stderr.trim()) {
      dispatch({ type: 'warning', message: result.stderr.trim() });
    }
  
    const exitInfo = result.timedOut
      ? 'timed out (60s)'
      : `exit ${result.exitCode}`;
    dispatch({ type: 'info', message: `[${exitInfo}] ${(result.durationMs / 1000).toFixed(1)}s` });
  } catch (err) {
    dispatch({ type: 'spinner-stop' });
    dispatch({ type: 'error', message: `Failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}

