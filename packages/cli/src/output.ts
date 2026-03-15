const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';
const ITALIC = '\x1b[3m';
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const MAGENTA = '\x1b[35m';
const CYAN = '\x1b[36m';
const WHITE = '\x1b[37m';
const RESET = '\x1b[0m';

// 256-color helpers
function fg256(code: number, text: string): string {
  return `\x1b[38;5;${code}m${text}${RESET}`;
}

function bgFg(bg: number, fg: number, text: string): string {
  return `\x1b[48;5;${bg};38;5;${fg}m${text}${RESET}`;
}

export function bold(text: string): string {
  return `${BOLD}${text}${RESET}`;
}

export function dim(text: string): string {
  return `${DIM}${text}${RESET}`;
}

export function green(text: string): string {
  return `${GREEN}${text}${RESET}`;
}

export function red(text: string): string {
  return `${RED}${text}${RESET}`;
}

export function yellow(text: string): string {
  return `${YELLOW}${text}${RESET}`;
}

export function cyan(text: string): string {
  return `${CYAN}${text}${RESET}`;
}

export function blue(text: string): string {
  return `${BLUE}${text}${RESET}`;
}

export function magenta(text: string): string {
  return `${MAGENTA}${text}${RESET}`;
}

export function white(text: string): string {
  return `${WHITE}${text}${RESET}`;
}

export function italic(text: string): string {
  return `${ITALIC}${text}${RESET}`;
}

export { fg256, bgFg };

export function header(text: string): void {
  console.log(`\n${BOLD}${CYAN}▸ ${text}${RESET}`);
}

export function success(text: string): void {
  console.log(`${GREEN}✓${RESET} ${text}`);
}

export function fail(text: string): void {
  console.log(`${RED}✗${RESET} ${text}`);
}

export function warn(text: string): void {
  console.log(`${YELLOW}⚠${RESET} ${text}`);
}

export function info(text: string): void {
  console.log(`${DIM}${text}${RESET}`);
}

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, '');
}

function visibleLength(str: string): number {
  return stripAnsi(str).length;
}

/**
 * Print a simple table with headers and rows.
 */
export function table(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, i) =>
    Math.max(visibleLength(h), ...rows.map((r) => visibleLength(r[i] ?? ''))),
  );

  const headerLine = headers
    .map((h, i) => h.padEnd(widths[i]))
    .join('  ');
  const separator = widths.map((w) => '─'.repeat(w)).join('──');

  console.log(`  ${bold(headerLine)}`);
  console.log(`  ${dim(separator)}`);
  for (const row of rows) {
    const line = row.map((cell, i) => {
      const pad = widths[i] - visibleLength(cell);
      return cell + ' '.repeat(Math.max(0, pad));
    }).join('  ');
    console.log(`  ${line}`);
  }
}
