import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStdin } from 'ink';
import { Buffer } from 'node:buffer';

type Key = {
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
  pageDown?: boolean;
  pageUp?: boolean;
  return?: boolean;
  escape?: boolean;
  ctrl?: boolean;
  shift?: boolean;
  tab?: boolean;
  backspace?: boolean;
  delete?: boolean;
  meta?: boolean;
  paste?: boolean;
};

type ParsedKeypress = {
  name: string;
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  option: boolean;
  sequence: string;
};

type Handler = (input: string, key: Key) => void;

type Options = {
  isActive?: boolean;
};

let activeRawModeUsers = 0;

function acquireStableRawMode(setRawMode: (isEnabled: boolean) => void): () => void {
  let released = false;
  if (activeRawModeUsers === 0) setRawMode(true);
  activeRawModeUsers += 1;

  return () => {
    if (released) return;
    released = true;
    activeRawModeUsers = Math.max(0, activeRawModeUsers - 1);
    if (activeRawModeUsers === 0) setRawMode(false);
  };
}

export function acquireStableRawModeForTests(setRawMode: (isEnabled: boolean) => void): () => void {
  return acquireStableRawMode(setRawMode);
}

export function resetStableRawModeForTests(): void {
  activeRawModeUsers = 0;
}

type BracketedPasteSegment = {
  kind: 'keys' | 'paste';
  value: string;
};

export type BracketedPasteState = {
  active: boolean;
  buffer: string;
};

const metaKeyCodeRe = /^(?:\x1b)([a-zA-Z0-9])$/;
const fnKeyRe = /^(?:\x1b+)(O|N|\[|\[\[)(?:(\d+)(?:;(\d+))?([~^$])|(?:1;)?(\d+)?([a-zA-Z]))/;
const keyName: Record<string, string> = {
  OP: 'f1',
  OQ: 'f2',
  OR: 'f3',
  OS: 'f4',
  '[11~': 'f1',
  '[12~': 'f2',
  '[13~': 'f3',
  '[14~': 'f4',
  '[[A': 'f1',
  '[[B': 'f2',
  '[[C': 'f3',
  '[[D': 'f4',
  '[[E': 'f5',
  '[15~': 'f5',
  '[17~': 'f6',
  '[18~': 'f7',
  '[19~': 'f8',
  '[20~': 'f9',
  '[21~': 'f10',
  '[23~': 'f11',
  '[24~': 'f12',
  '[A': 'up',
  '[B': 'down',
  '[C': 'right',
  '[D': 'left',
  '[E': 'clear',
  '[F': 'end',
  '[H': 'home',
  OA: 'up',
  OB: 'down',
  OC: 'right',
  OD: 'left',
  OE: 'clear',
  OF: 'end',
  OH: 'home',
  '[1~': 'home',
  '[2~': 'insert',
  '[3~': 'delete',
  '[4~': 'end',
  '[5~': 'pageup',
  '[6~': 'pagedown',
  '[[5~': 'pageup',
  '[[6~': 'pagedown',
  '[7~': 'home',
  '[8~': 'end',
  '[a': 'up',
  '[b': 'down',
  '[c': 'right',
  '[d': 'left',
  '[e': 'clear',
  '[2$': 'insert',
  '[3$': 'delete',
  '[5$': 'pageup',
  '[6$': 'pagedown',
  '[7$': 'home',
  '[8$': 'end',
  Oa: 'up',
  Ob: 'down',
  Oc: 'right',
  Od: 'left',
  Oe: 'clear',
  '[2^': 'insert',
  '[3^': 'delete',
  '[5^': 'pageup',
  '[6^': 'pagedown',
  '[7^': 'home',
  '[8^': 'end',
  '[Z': 'tab',
};
const nonAlphanumericKeys = [...Object.values(keyName), 'backspace'];
const pasteStartMarkers = ['\x1b[200~', '[200~'];
const pasteEndMarkers = ['\x1b[201~', '[201~'];

function isShiftKey(code: string): boolean {
  return ['[a', '[b', '[c', '[d', '[e', '[2$', '[3$', '[5$', '[6$', '[7$', '[8$', '[Z'].includes(code);
}

function isCtrlKey(code: string): boolean {
  return ['Oa', 'Ob', 'Oc', 'Od', 'Oe', '[2^', '[3^', '[5^', '[6^', '[7^', '[8^'].includes(code);
}

function parseKeypress(value: string | Buffer = ''): ParsedKeypress {
  let input = value;
  let parts: RegExpExecArray | null;

  if (Buffer.isBuffer(input)) {
    if (input[0] > 127 && input[1] === undefined) {
      input[0] -= 128;
      input = `\x1b${String(input)}`;
    } else {
      input = String(input);
    }
  } else if (input !== undefined && typeof input !== 'string') {
    input = String(input);
  } else if (!input) {
    input = '';
  }

  const key: ParsedKeypress = {
    name: '',
    ctrl: false,
    meta: false,
    shift: false,
    option: false,
    sequence: input,
  };

  if (input === '\r') {
    key.name = 'return';
  } else if (input === '\n') {
    key.name = 'enter';
  } else if (input === '\t') {
    key.name = 'tab';
  } else if (input === '\b' || input === '\x1b\b') {
    key.name = 'backspace';
    key.meta = input.charAt(0) === '\x1b';
  } else if (input === '\x7f' || input === '\x1b\x7f') {
    key.name = 'delete';
    key.meta = input.charAt(0) === '\x1b';
  } else if (input === '\x1b' || input === '\x1b\x1b') {
    key.name = 'escape';
    key.meta = input.length === 2;
  } else if (input === ' ' || input === '\x1b ') {
    key.name = 'space';
    key.meta = input.length === 2;
  } else if (input.length === 1 && input <= '\x1a') {
    key.name = String.fromCharCode(input.charCodeAt(0) + 'a'.charCodeAt(0) - 1);
    key.ctrl = true;
  } else if (input.length === 1 && input >= '0' && input <= '9') {
    key.name = 'number';
  } else if (input.length === 1 && input >= 'a' && input <= 'z') {
    key.name = input;
  } else if (input.length === 1 && input >= 'A' && input <= 'Z') {
    key.name = input.toLowerCase();
    key.shift = true;
  } else if ((parts = metaKeyCodeRe.exec(input))) {
    key.meta = true;
    key.shift = /^[A-Z]$/.test(parts[1]);
  } else if ((parts = fnKeyRe.exec(input))) {
    const segments = [...input];
    if (segments[0] === '\u001b' && segments[1] === '\u001b') {
      key.option = true;
    }

    const code = [parts[1], parts[2], parts[4], parts[6]].filter(Boolean).join('');
    const modifier = Number(parts[3] || parts[5] || 1) - 1;
    key.ctrl = !!(modifier & 4);
    key.meta = !!(modifier & 10);
    key.shift = !!(modifier & 1);
    key.name = keyName[code] || '';
    key.shift = isShiftKey(code) || key.shift;
    key.ctrl = isCtrlKey(code) || key.ctrl;
  }

  return key;
}

function findMarker(value: string, markers: string[], fromIndex: number): { index: number; marker: string } | null {
  let best: { index: number; marker: string } | null = null;
  for (const marker of markers) {
    const index = value.indexOf(marker, fromIndex);
    if (index === -1) continue;
    if (!best || index < best.index || (index === best.index && marker.length > best.marker.length)) {
      best = { index, marker };
    }
  }
  return best;
}

export function splitBracketedPasteInput(
  state: BracketedPasteState,
  chunk: string,
): { state: BracketedPasteState; segments: BracketedPasteSegment[] } {
  const segments: BracketedPasteSegment[] = [];
  let active = state.active;
  let buffer = state.buffer;
  let index = 0;

  while (index < chunk.length) {
    if (!active) {
      const start = findMarker(chunk, pasteStartMarkers, index);
      if (!start) {
        const value = chunk.slice(index);
        if (value) segments.push({ kind: 'keys', value });
        break;
      }

      const before = chunk.slice(index, start.index);
      if (before) segments.push({ kind: 'keys', value: before });
      active = true;
      buffer = '';
      index = start.index + start.marker.length;
      continue;
    }

    const end = findMarker(chunk, pasteEndMarkers, index);
    if (!end) {
      buffer += chunk.slice(index);
      break;
    }

    const pasted = buffer + chunk.slice(index, end.index);
    if (pasted) segments.push({ kind: 'paste', value: pasted });
    buffer = '';
    active = false;
    index = end.index + end.marker.length;
  }

  return {
    state: { active, buffer },
    segments,
  };
}

type StdinContext = ReturnType<typeof useStdin> & {
  internal_exitOnCtrlC?: boolean;
  internal_eventEmitter?: {
    on: (event: 'input', handler: (data: string) => void) => void;
    removeListener: (event: 'input', handler: (data: string) => void) => void;
  };
};

export function useStableInput(inputHandler: Handler, options: Options = {}) {
  const { setRawMode, isRawModeSupported, internal_exitOnCtrlC, internal_eventEmitter } = useStdin() as StdinContext;
  const handlerRef = useRef(inputHandler);
  const isActiveRef = useRef(options.isActive !== false);
  const pasteStateRef = useRef<BracketedPasteState>({ active: false, buffer: '' });

  useLayoutEffect(() => {
    handlerRef.current = inputHandler;
    isActiveRef.current = options.isActive !== false;
  }, [inputHandler, options.isActive]);

  // Ink's stock hook enables raw mode in a passive effect and re-registers the
  // listener on every render. That creates a brief cooked-mode window at startup
  // and churns EventEmitter ordering while the app streams. Keep raw mode and
  // listener registration stable instead.
  useLayoutEffect(() => {
    if (options.isActive === false || !isRawModeSupported) return;
    return acquireStableRawMode(setRawMode);
  }, [options.isActive, isRawModeSupported, setRawMode]);

  useEffect(() => {
    if (!internal_eventEmitter) return;

    const handleKeyData = (data: string) => {
      if (!data) return;

      const keypress = parseKeypress(data);
      const key: Key = {
        upArrow: keypress.name === 'up',
        downArrow: keypress.name === 'down',
        leftArrow: keypress.name === 'left',
        rightArrow: keypress.name === 'right',
        pageDown: keypress.name === 'pagedown',
        pageUp: keypress.name === 'pageup',
        return: keypress.name === 'return',
        escape: keypress.name === 'escape',
        ctrl: keypress.ctrl,
        shift: keypress.shift,
        tab: keypress.name === 'tab',
        backspace: keypress.name === 'backspace',
        delete: keypress.name === 'delete',
        meta: keypress.meta || keypress.name === 'escape' || keypress.option,
      };

      let input = keypress.ctrl ? keypress.name : keypress.sequence;
      if (nonAlphanumericKeys.includes(keypress.name)) input = '';
      if (input.startsWith('\u001b')) input = input.slice(1);
      if (input.length === 1 && /[A-Z]/.test(input[0])) key.shift = true;

      if ((input === 'c' && key.ctrl) && internal_exitOnCtrlC) return;

      handlerRef.current(input, key);
    };

    const handleData = (data: string) => {
      if (!isActiveRef.current) return;

      const split = splitBracketedPasteInput(pasteStateRef.current, data);
      pasteStateRef.current = split.state;

      for (const segment of split.segments) {
        if (segment.kind === 'paste') {
          handlerRef.current(segment.value, { paste: true });
        } else {
          handleKeyData(segment.value);
        }
      }
    };

    internal_eventEmitter.on('input', handleData);
    return () => {
      internal_eventEmitter.removeListener('input', handleData);
    };
  }, [internal_eventEmitter, internal_exitOnCtrlC]);
}
