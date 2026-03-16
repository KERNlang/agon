/**
 * Centralized terminal output manager for the Agon CLI.
 *
 * Pure formatting logic lives in KERN (packages/core/src/kern/output-manager.kern).
 * This wrapper owns all actual terminal IO — writes, cursor movement, timers.
 *
 * Usage:
 *   const out = new OutputManager();
 *   const spin = out.spinner('thinking...');
 *   spin.update('still thinking...');
 *   spin.stop('done');
 *   out.engineBlock('claude', 208, 'Here is my response...');
 */

import {
  formatSpinnerFrame,
  formatEngineBlock,
  formatStatusLine,
  clearLinesSequence,
  cursorUpSequence,
  clearLineSequence,
  wordWrap,
} from '@agon/core';

// ── Spinner frames (Braille pattern — smooth rotation) ──────────────
const SPINNER_FRAMES = ['\u280B', '\u2819', '\u2839', '\u2838', '\u283C', '\u2834', '\u2826', '\u2827', '\u2807', '\u280F'];

// ── Spinner return type ─────────────────────────────────────────────
export interface SpinnerHandle {
  /** Update the message while spinning. */
  update: (msg: string) => void;
  /** Stop with a success message (prints checkmark). Pass empty string to clear silently. */
  stop: (msg: string) => void;
  /** Clear the spinner line without any output. */
  clear: () => void;
}

// ── OutputManager ───────────────────────────────────────────────────

export class OutputManager {
  /** Number of lines written since last clear/reset — used for cursor rewrite patterns. */
  private lineCount = 0;

  // ── Low-level primitives ────────────────────────────────────────

  /** Write raw text to stdout (no newline). */
  write(text: string): void {
    process.stdout.write(text);
  }

  /** Write a line to stdout (appends newline). Tracks line count. */
  writeLine(text: string): void {
    this.write(text + '\n');
    this.lineCount++;
  }

  /** Clear the current line (carriage return + ANSI clear). */
  clearLine(): void {
    this.write(clearLineSequence());
  }

  /** Move cursor up N lines and clear each one. Decrements lineCount. */
  clearLines(n: number): void {
    if (n <= 0) return;
    this.write(clearLinesSequence(n));
    this.lineCount = Math.max(0, this.lineCount - n);
  }

  /** Move cursor up N lines without clearing. */
  cursorUp(n: number): void {
    if (n <= 0) return;
    this.write(cursorUpSequence(n));
  }

  /** Reset the tracked line count (e.g. after a full-screen repaint). */
  resetLineCount(): void {
    this.lineCount = 0;
  }

  /** Get the current tracked line count. */
  getLineCount(): number {
    return this.lineCount;
  }

  // ── Spinner ─────────────────────────────────────────────────────

  /**
   * Start an animated spinner on the current line.
   *
   * Returns a handle with `update(msg)`, `stop(msg)`, and `clear()`.
   * The spinner redraws at 80ms using KERN's `formatSpinnerFrame`.
   */
  spinner(msg: string): SpinnerHandle {
    let frameIndex = 0;
    let text = msg;

    const timer = setInterval(() => {
      const line = formatSpinnerFrame(SPINNER_FRAMES, frameIndex, text);
      this.write(clearLineSequence() + line);
      frameIndex++;
    }, 80);

    return {
      update: (m: string) => {
        text = m;
      },
      stop: (m: string) => {
        clearInterval(timer);
        if (m) {
          this.write(clearLineSequence() + `  \x1b[32m\u2713\x1b[0m ${m}\n`);
          this.lineCount++;
        } else {
          this.write(clearLineSequence());
        }
      },
      clear: () => {
        clearInterval(timer);
        this.write(clearLineSequence());
      },
    };
  }

  // ── Engine block ────────────────────────────────────────────────

  /**
   * Print a bordered engine response block.
   *
   * Uses KERN's `formatEngineBlock` for the pure formatting, then
   * writes each line to stdout. Optionally word-wraps the response.
   */
  engineBlock(engineId: string, color: number, response: string, maxWidth?: number): void {
    const termWidth = maxWidth ?? process.stdout.columns ?? 80;
    const contentWidth = termWidth - 4; // account for "  | " prefix
    const wrapped = wordWrap(response.trim(), contentWidth);
    const lines = formatEngineBlock(engineId, color, wrapped, termWidth);

    for (const line of lines) {
      this.writeLine(line);
    }
  }

  // ── Status line ─────────────────────────────────────────────────

  /**
   * Print a single engine status line (e.g. during forge competition).
   *
   * Uses KERN's `formatStatusLine`. Useful for building multi-engine
   * progress displays that get rewritten with cursor-up patterns.
   */
  statusLine(engineId: string, color: number, status: string, elapsed?: number): void {
    const line = formatStatusLine(engineId, color, status, elapsed ?? 0);
    this.writeLine(line);
  }

  // ── Rewrite pattern helper ──────────────────────────────────────

  /**
   * Rewrite N previously-written lines. Moves cursor up, clears each line,
   * writes the new lines. Useful for animated multi-line displays.
   *
   * @param count  Number of lines to move up and overwrite.
   * @param lines  New lines to write (should be same count or fewer).
   */
  rewriteLines(count: number, lines: string[]): void {
    this.write(cursorUpSequence(count));
    for (const line of lines) {
      this.write('\x1b[2K' + line + '\n');
    }
    // If fewer new lines than old, clear remaining
    for (let i = lines.length; i < count; i++) {
      this.write('\x1b[2K\n');
    }
  }
}
