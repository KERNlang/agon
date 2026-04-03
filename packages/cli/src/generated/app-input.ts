import { getGhostCompletion } from '../ghost-text.js';

export function cleanInputValue(value: string): string {
  return value.replace(/\x1b\[20[01]~/g, '').replace(/\[200~/g, '').replace(/\[201~/g, '').replace(/\t/g, '');
}

export function cleanSubmitValue(value: string): string {
  return value.replace(/\x1b\[20[01]~/g, '').replace(/\[200~/g, '').replace(/\[201~/g, '').trim();
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

export function tryGhostComplete(inputValue: string, commands: any[], engineIds: string[]): string|null {
  return getGhostCompletion(inputValue, commands, engineIds);
}

