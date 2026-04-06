import { getGhostCompletion } from '../ghost-text.js';

import { stripBracketedPasteMarkers } from '../input-utils.js';

export function cleanInputValue(value: string): string {
  return stripBracketedPasteMarkers(value);
}

export function cleanSubmitValue(value: string): string {
  return stripBracketedPasteMarkers(value).trim();
}

export function findInputChange(previous: string, next: string): {start:number, removed:string, inserted:string} {
  let start = 0;
  while (start < previous.length && start < next.length && previous[start] === next[start]) {
    start++;
  }
  
  let previousEnd = previous.length;
  let nextEnd = next.length;
  while (previousEnd > start && nextEnd > start && previous[previousEnd - 1] === next[nextEnd - 1]) {
    previousEnd--;
    nextEnd--;
  }
  
  return {
    start,
    removed: previous.slice(start, previousEnd),
    inserted: next.slice(start, nextEnd),
  };
}

export function navigateHistory(direction: 'up'|'down', currentIndex: number, history: string[]): {index:number, value:string} {
  if (direction === 'up' && history.length > 0) {
    const newIndex = currentIndex === -1 ? history.length - 1 : Math.max(0, currentIndex - 1);
    return { index: newIndex, value: history[newIndex] };
  }
  if (direction === 'down' && currentIndex >= 0) {
    const newIndex = currentIndex + 1;
    if (newIndex >= history.length) {
      return { index: -1, value: '' };
    }
    return { index: newIndex, value: history[newIndex] };
  }
  return { index: currentIndex, value: '' };
}

export interface EscapeDecision {
  action: 'close-slash'|'close-engine-picker'|'cancel-question'|'interrupt'|'clear-input'|'noop';
}

export function resolveEscapeAction(opts: {replState:string,inputValue:string,slashPickerOpen:boolean,enginePickerOpen:boolean,questionOpen:boolean}): EscapeDecision {
  if (opts.slashPickerOpen) return { action: 'close-slash' };
  if (opts.enginePickerOpen) return { action: 'close-engine-picker' };
  if (opts.questionOpen) return { action: 'cancel-question' };

  if (opts.replState !== 'idle') {
    return { action: 'interrupt' };
  }

  if (opts.inputValue) {
    return { action: 'clear-input' };
  }

  return { action: 'noop' };
}

export function tryGhostComplete(inputValue: string, commands: any[], engineIds: string[]): string|null {
  return getGhostCompletion(inputValue, commands, engineIds);
}
