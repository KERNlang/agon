import { fg256, bold, dim } from './output.js';

// ── Types ────────────────────────────────────────────────────────────

export interface InputEngine {
  showPrompt(): void;
  pause(): void;
  resume(): void;
  close(): void;
  /** Set up scroll region with pinned input at bottom */
  setupLayout(): void;
}

interface SlashCommand {
  cmd: string;
  desc: string;
}

type Mode = 'editing' | 'picking';

// ── ANSI helpers ─────────────────────────────────────────────────────

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
}

// ── Layout: pinned bottom input ─────────────────────────────────────

function getTermHeight(): number {
  return process.stdout.rows || 24;
}

/** Set scroll region to [1, height-2], leaving last 2 lines for separator + input */
function setupScrollRegion(): void {
  const h = getTermHeight();
  process.stdout.write(`\x1b[1;${h - 2}r`); // scroll region
  process.stdout.write(`\x1b[${h - 1};1H`);  // separator line
  process.stdout.write(`\x1b[2K${dim('─'.repeat(process.stdout.columns || 48))}`);
  process.stdout.write(`\x1b[${h};1H`);       // input line
  process.stdout.write(`\x1b[2K`);             // clear input line
}

/** Move cursor into scroll region (for handler output) */
function enterScrollRegion(): void {
  const h = getTermHeight();
  // Move to the last line of the scroll region
  process.stdout.write(`\x1b[${h - 2};1H`);
  // Ensure we're at a new line for output
  process.stdout.write('\n');
}

/** Render input at the fixed bottom line */
function renderAtBottom(prompt: string, buffer: string, cursor: number): void {
  const h = getTermHeight();
  const promptLen = stripAnsi(prompt).length;
  // Move to last line, clear it, write prompt + buffer
  process.stdout.write(`\x1b[${h};1H\x1b[2K${prompt}${buffer}`);
  // Position cursor
  const col = promptLen + cursor + 1;
  process.stdout.write(`\x1b[${h};${col}H`);
}

/** Reset scroll region to full terminal (cleanup) */
function resetScrollRegion(): void {
  const h = getTermHeight();
  process.stdout.write(`\x1b[1;${h}r`);
  process.stdout.write(`\x1b[${h};1H`);
}

// ── LineEditor ───────────────────────────────────────────────────────

class LineEditor {
  buffer = '';
  cursor = 0;
  private promptFn: () => string;

  constructor(promptFn: () => string) {
    this.promptFn = promptFn;
  }

  insert(text: string): void {
    this.buffer =
      this.buffer.slice(0, this.cursor) + text + this.buffer.slice(this.cursor);
    this.cursor += text.length;
  }

  backspace(): boolean {
    if (this.cursor === 0) return false;
    this.buffer =
      this.buffer.slice(0, this.cursor - 1) + this.buffer.slice(this.cursor);
    this.cursor--;
    return true;
  }

  delete(): void {
    if (this.cursor >= this.buffer.length) return;
    this.buffer =
      this.buffer.slice(0, this.cursor) + this.buffer.slice(this.cursor + 1);
  }

  moveLeft(): void {
    if (this.cursor > 0) this.cursor--;
  }
  moveRight(): void {
    if (this.cursor < this.buffer.length) this.cursor++;
  }
  moveHome(): void {
    this.cursor = 0;
  }
  moveEnd(): void {
    this.cursor = this.buffer.length;
  }

  killLine(): void {
    this.buffer = '';
    this.cursor = 0;
  }

  killToEnd(): void {
    this.buffer = this.buffer.slice(0, this.cursor);
  }

  deleteWordBack(): void {
    if (this.cursor === 0) return;
    let i = this.cursor - 1;
    while (i > 0 && this.buffer[i - 1] === ' ') i--;
    while (i > 0 && this.buffer[i - 1] !== ' ') i--;
    this.buffer = this.buffer.slice(0, i) + this.buffer.slice(this.cursor);
    this.cursor = i;
  }

  clear(): void {
    this.buffer = '';
    this.cursor = 0;
  }

  getLine(): string {
    return this.buffer;
  }

  render(): void {
    const prompt = this.promptFn();
    renderAtBottom(prompt, this.buffer, this.cursor);
  }
}

// ── SlashPicker ──────────────────────────────────────────────────────

class SlashPicker {
  private commands: SlashCommand[];
  filter = '';
  selectedIndex = 0;
  private maxVisible = 8;
  private lastRenderedLines = 0;

  constructor(commands: SlashCommand[]) {
    this.commands = commands;
  }

  activate(): void {
    this.filter = '';
    this.selectedIndex = 0;
  }

  filtered(): SlashCommand[] {
    if (!this.filter) return this.commands;
    return this.commands.filter((c) => c.cmd.slice(1).startsWith(this.filter));
  }

  moveUp(): void {
    const items = this.filtered();
    if (items.length === 0) return;
    this.selectedIndex =
      (this.selectedIndex - 1 + items.length) % items.length;
  }

  moveDown(): void {
    const items = this.filtered();
    if (items.length === 0) return;
    this.selectedIndex = (this.selectedIndex + 1) % items.length;
  }

  getSelected(): string | null {
    const items = this.filtered();
    if (items.length === 0) return null;
    const idx = Math.min(this.selectedIndex, items.length - 1);
    return items[idx].cmd;
  }

  render(): void {
    const items = this.filtered();
    const h = getTermHeight();

    // Scrolling window
    const sel = Math.min(this.selectedIndex, items.length - 1);
    let start = 0;
    if (sel >= this.maxVisible) {
      start = sel - this.maxVisible + 1;
    }
    const visible = items.length === 0
      ? []
      : items.slice(start, start + this.maxVisible);

    // How many lines we'll draw
    const lineCount = items.length === 0 ? 1 : visible.length;

    // Render ABOVE separator (bottom-up), starting at row (h-2-lineCount+1)
    const startRow = h - 2 - lineCount;

    // Clear old picker lines first
    for (let i = 0; i < this.lastRenderedLines; i++) {
      const row = h - 2 - this.lastRenderedLines + i;
      if (row > 0) process.stdout.write(`\x1b[${row};1H\x1b[2K`);
    }

    if (items.length === 0) {
      process.stdout.write(`\x1b[${startRow + 1};1H\x1b[2K  ${dim('No matching commands')}`);
    } else {
      for (let i = 0; i < visible.length; i++) {
        const row = startRow + 1 + i;
        const { cmd, desc } = visible[i];
        const isSelected = (start + i) === sel;
        const prefix = isSelected ? fg256(214, '› ') : '  ';
        const cmdText = isSelected ? fg256(214, bold(cmd)) : dim(cmd);
        const descText = dim(desc.trim());
        process.stdout.write(`\x1b[${row};1H\x1b[2K${prefix}${cmdText}  ${descText}`);
      }
    }

    this.lastRenderedLines = lineCount;
  }

  clearDisplay(): void {
    if (this.lastRenderedLines === 0) return;
    const h = getTermHeight();
    for (let i = 0; i < this.lastRenderedLines; i++) {
      const row = h - 2 - this.lastRenderedLines + i;
      if (row > 0) process.stdout.write(`\x1b[${row};1H\x1b[2K`);
    }
    this.lastRenderedLines = 0;
  }
}

// ── createInputEngine ────────────────────────────────────────────────

export function createInputEngine(opts: {
  prompt: () => string;
  onSubmit: (line: string) => void;
  onInterrupt: () => void;
  commands: ReadonlyArray<{ readonly cmd: string; readonly desc: string }>;
}): InputEngine {
  const editor = new LineEditor(opts.prompt);
  const picker = new SlashPicker(
    opts.commands.map((c) => ({ cmd: c.cmd, desc: c.desc })),
  );
  let mode: Mode = 'editing';
  let paused = false;

  function positionCursor(): void {
    const prompt = opts.prompt();
    const promptLen = stripAnsi(prompt).length;
    const col = promptLen + editor.cursor + 1;
    const h = getTermHeight();
    process.stdout.write(`\x1b[${h};${col}H`);
  }

  function handleData(data: Buffer): void {
    if (paused) return;

    // Paste detection: multi-byte non-escape = paste
    if (data.length > 1 && data[0] !== 0x1b) {
      // Strip newlines/carriage returns — editor is single-line
      const text = data.toString('utf-8').replace(/[\r\n]/g, ' ').trim();
      if (!text) return;
      if (mode === 'picking') {
        picker.clearDisplay();
        mode = 'editing';
        editor.clear();
      }
      editor.insert(text);
      editor.render();
      return;
    }

    // Escape sequences (arrows, delete, home, end)
    if (data.length > 1 && data[0] === 0x1b) {
      handleEscapeSequence(data);
      return;
    }

    // Single byte
    const byte = data[0];
    switch (byte) {
      case 0x01: // Ctrl+A — Home
        if (mode === 'editing') {
          editor.moveHome();
          editor.render();
        }
        return;

      case 0x03: // Ctrl+C
        if (mode === 'picking') {
          picker.clearDisplay();
          mode = 'editing';
          editor.clear();
          editor.render();
          return;
        }
        if (editor.buffer.length > 0) {
          // Clear current line, show fresh prompt
          editor.clear();
          process.stdout.write('\n');
          editor.render();
          return;
        }
        opts.onInterrupt();
        return;

      case 0x04: // Ctrl+D
        if (editor.buffer.length === 0) {
          opts.onInterrupt();
        }
        return;

      case 0x05: // Ctrl+E — End
        if (mode === 'editing') {
          editor.moveEnd();
          editor.render();
        }
        return;

      case 0x0b: // Ctrl+K — Kill to end of line
        if (mode === 'editing') {
          editor.killToEnd();
          editor.render();
        }
        return;

      case 0x0d: // Enter
        handleEnter();
        return;

      case 0x15: // Ctrl+U — Kill entire line
        if (mode === 'picking') {
          picker.clearDisplay();
          mode = 'editing';
        }
        editor.killLine();
        editor.render();
        return;

      case 0x17: // Ctrl+W — Delete word back
        if (mode === 'editing') {
          editor.deleteWordBack();
          editor.render();
        }
        return;

      case 0x7f: // Backspace (macOS)
      case 0x08: // Backspace
        handleBackspace();
        return;

      case 0x09: // Tab — auto-complete in picker
        if (mode === 'picking') {
          autoComplete();
        }
        return;

      case 0x1b: // Bare Escape (no sequence following)
        if (mode === 'picking') {
          picker.clearDisplay();
          mode = 'editing';
          editor.clear();
          editor.render();
        }
        return;

      default:
        if (byte >= 0x20 && byte < 0x7f) {
          handleChar(String.fromCharCode(byte));
        }
        return;
    }
  }

  function handleChar(ch: string): void {
    if (mode === 'editing') {
      // '/' at empty buffer triggers picker
      if (ch === '/' && editor.cursor === 0 && editor.buffer.length === 0) {
        editor.insert(ch);
        editor.render();
        mode = 'picking';
        picker.activate();
        picker.render();
        positionCursor();
        return;
      }
      editor.insert(ch);
      editor.render();
    } else {
      // Picker mode — space auto-completes
      if (ch === ' ') {
        autoComplete();
        return;
      }
      picker.filter += ch;
      picker.selectedIndex = 0;
      editor.insert(ch);
      editor.render();
      picker.render();
      positionCursor();
    }
  }

  function handleBackspace(): void {
    if (mode === 'picking') {
      if (picker.filter.length > 0) {
        picker.filter = picker.filter.slice(0, -1);
        picker.selectedIndex = 0;
        editor.backspace();
        editor.render();
        picker.render();
        positionCursor();
      } else {
        // Backspace past '/' — cancel picker
        picker.clearDisplay();
        mode = 'editing';
        editor.clear();
        editor.render();
      }
    } else {
      editor.backspace();
      editor.render();
    }
  }

  function handleEnter(): void {
    if (mode === 'picking') {
      const selected = picker.getSelected();
      picker.clearDisplay();
      mode = 'editing';
      editor.clear();
      if (selected) {
        process.stdout.write('\n');
        opts.onSubmit(selected);
      } else {
        editor.render();
      }
    } else {
      const line = editor.getLine();
      editor.clear();
      process.stdout.write('\n');
      opts.onSubmit(line);
    }
  }

  function autoComplete(): void {
    const selected = picker.getSelected();
    picker.clearDisplay();
    mode = 'editing';
    editor.clear();
    if (selected) {
      editor.insert(selected + ' ');
    }
    editor.render();
  }

  function handleEscapeSequence(data: Buffer): void {
    const seq = data.toString('utf-8');
    if (mode === 'picking') {
      if (seq === '\x1b[A') {
        picker.moveUp();
        picker.render();
        positionCursor();
      } else if (seq === '\x1b[B') {
        picker.moveDown();
        picker.render();
        positionCursor();
      }
      // Ignore left/right/home/end in picker mode
    } else {
      if (seq === '\x1b[C') {
        editor.moveRight();
        editor.render();
      } else if (seq === '\x1b[D') {
        editor.moveLeft();
        editor.render();
      } else if (seq === '\x1b[H' || seq === '\x1b[1~') {
        editor.moveHome();
        editor.render();
      } else if (seq === '\x1b[F' || seq === '\x1b[4~') {
        editor.moveEnd();
        editor.render();
      } else if (seq === '\x1b[3~') {
        editor.delete();
        editor.render();
      }
    }
  }

  function startListening(): void {
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.on('data', handleData);
  }

  function stopListening(): void {
    process.stdin.removeListener('data', handleData);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
  }

  // Start
  startListening();

  // Handle terminal resize — update scroll region
  process.stdout.on('resize', () => {
    if (!paused) {
      setupScrollRegion();
      editor.render();
    }
  });

  return {
    setupLayout() {
      setupScrollRegion();
    },

    showPrompt() {
      editor.render();
    },

    pause() {
      if (paused) return;
      paused = true;
      if (mode === 'picking') {
        picker.clearDisplay();
        mode = 'editing';
        editor.clear();
      }
      stopListening();
      // Move cursor into scroll region so handler output goes there
      enterScrollRegion();
      // Register process SIGINT so Ctrl+C works while handlers use stdin
      process.on('SIGINT', opts.onInterrupt);
    },

    resume() {
      if (!paused) return;
      paused = false;
      process.removeListener('SIGINT', opts.onInterrupt);
      // Re-render separator + input at bottom
      setupScrollRegion();
      startListening();
    },

    close() {
      resetScrollRegion();
      stopListening();
      process.removeListener('SIGINT', opts.onInterrupt);
      process.exit(0);
    },
  };
}
