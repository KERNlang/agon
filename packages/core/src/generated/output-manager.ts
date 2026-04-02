export function formatSpinnerFrame(frames: string[], index: number, text: string): string {
  const frame = frames[index % frames.length];
  return `  \x1b[38;5;214m${frame}\x1b[0m \x1b[2m${text}\x1b[0m`;
}

export function formatEngineBlock(engineId: string, color: number, lines: string[], maxWidth: number): string[] {
  const result: string[] = [];
  const colorStart = `\x1b[38;5;${color}m`;
  const bold = '\x1b[1m';
  const reset = '\x1b[0m';
  
  result.push(`  ${colorStart}\u250c\u2500\u2500${reset} ${colorStart}${bold}${engineId}${reset}`);
  
  for (const line of lines) {
    // Truncate to maxWidth if needed (account for "  | " prefix = 4 visible chars)
    const available = maxWidth - 4;
    const trimmed = line.length > available ? line.slice(0, available - 1) + '\u2026' : line;
    result.push(`  ${colorStart}\u2502${reset} ${trimmed}`);
  }
  
  result.push(`  ${colorStart}\u2514\u2500\u2500${reset}`);
  return result;
}

export function formatStatusLine(engineId: string, color: number, status: string, elapsed: number): string {
  const colorStart = `\x1b[38;5;${color}m`;
  const bold = '\x1b[1m';
  const dim = '\x1b[2m';
  const green = '\x1b[32m';
  const reset = '\x1b[0m';
  
  const paddedId = engineId.padEnd(10);
  
  if (status === 'done') {
    return `  ${green}\u2713${reset} ${colorStart}${bold}${paddedId}${reset} ${green}done${reset} ${dim}(${elapsed}s)${reset}`;
  }
  if (status === 'error' || status === 'failed') {
    return `  \x1b[31m\u2717${reset} ${colorStart}${bold}${paddedId}${reset} \x1b[31m${status}${reset} ${dim}(${elapsed}s)${reset}`;
  }
  if (status === 'running' || status === 'building') {
    const barLen = Math.min(10, Math.floor(elapsed / 3));
    const bar = '\u2593'.repeat(barLen);
    const empty = '\u2591'.repeat(Math.max(0, 10 - barLen));
    return `  ${colorStart}${bold}${paddedId}${reset} ${colorStart}${bar}${reset}${dim}${empty}${reset} ${dim}${elapsed}s${reset}`;
  }
  // queued / waiting / other
  return `  ${dim}\u25cb${reset} ${dim}${paddedId}${reset} ${dim}${status}${reset}`;
}

export function clearLinesSequence(count: number): string {
  let seq = '';
  for (let i = 0; i < count; i++) {
    seq += '\x1b[1A\x1b[2K';
  }
  return seq;
}

export function cursorUpSequence(count: number): string {
  if (count <= 0) return '';
  return `\x1b[${count}A`;
}

export function clearLineSequence(): string {
  return '\r\x1b[2K';
}

