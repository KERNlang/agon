import { spawnSync } from 'node:child_process';

import { parsePatch, patchSummary, applyPatchWithUndo, copyToClipboard, resolveWorkingDir } from '@agon/core';

import type { Dispatch } from '../handlers/types.js';

export interface ReviewAction {
  type: 'apply'|'edit'|'reject'|'copy';
}

export interface ReviewState {
  winnerId: string;
  patchPath: string;
  patchContent: string;
}

export function handleReviewAction(action: ReviewAction, review: ReviewState, dispatch: Dispatch): string|null {
  switch (action.type) {
    case 'apply': {
      const files = parsePatch(review.patchContent);
      const summary = patchSummary(files);
      dispatch({ type: 'info', message: summary });
  
      const result = applyPatchWithUndo(resolveWorkingDir(), review.patchContent);
      if (result.ok) {
        dispatch({ type: 'success', message: `Patch applied from ${review.winnerId}` });
        if (result.undoToken) {
          dispatch({ type: 'info', message: 'Undo available: /undo' });
          return result.undoToken;
        }
      } else {
        dispatch({ type: 'error', message: `Apply failed: ${result.error ?? 'unknown error'}` });
      }
      return null;
    }
    case 'edit': {
      try {
        const editor = process.env.EDITOR || process.env.VISUAL || 'vi';
        spawnSync(editor, [review.patchPath], { stdio: 'inherit' });
        dispatch({ type: 'info', message: `Opened ${review.patchPath} in ${editor}` });
      } catch (err) {
        dispatch({ type: 'error', message: `Editor failed: ${err instanceof Error ? err.message : String(err)}` });
      }
      return null;
    }
    case 'reject':
      dispatch({ type: 'info', message: 'Patch rejected.' });
      return null;
    case 'copy': {
      try {
        copyToClipboard(review.patchContent);
        dispatch({ type: 'success', message: 'Patch copied to clipboard' });
      } catch (err) {
        dispatch({ type: 'error', message: `Copy failed: ${err instanceof Error ? err.message : String(err)}` });
      }
      return null;
    }
  }
}

