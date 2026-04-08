// @kern-source: app-input:4
import { getGhostCompletion } from './ghost-text.js';

// @kern-source: app-input:5
import { stripBracketedPasteMarkers } from '../../input-utils.js';

// @kern-source: app-input:7
export function cleanInputValue(value: string): string {
  return stripBracketedPasteMarkers(value);
}

// @kern-source: app-input:13
export function cleanSubmitValue(value: string): string {
  return stripBracketedPasteMarkers(value).trim();
}

// @kern-source: app-input:19
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

// @kern-source: app-input:41
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

// @kern-source: app-input:58
export interface EscapeDecision {
  action: 'close-slash'|'close-engine-picker'|'cancel-question'|'interrupt'|'clear-input'|'noop';
}

// @kern-source: app-input:61
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

// @kern-source: app-input:79
export function tryGhostComplete(inputValue: string, commands: any[], engineIds: string[]): string|null {
  return getGhostCompletion(inputValue, commands, engineIds);
}

// @kern-source: app-input:85
export function shouldQueuePlanModeOnTab(opts: {replState:string,inputValue:string,activePlanState?:string|null}): boolean {
  if (opts.replState !== 'idle') return false;
  if (opts.inputValue.trim()) return false;
  if (opts.activePlanState && ['planning', 'awaiting_approval', 'running', 'paused'].includes(opts.activePlanState)) return false;
  return true;
}

