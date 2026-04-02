export function getGhostCompletion(input: string, commands: Array<{cmd:string}>): string|null {
  if (!input || !input.startsWith('/')) return null;
  const lower = input.toLowerCase();
  for (const c of commands) {
    if (c.cmd.toLowerCase().startsWith(lower) && c.cmd.length > input.length) {
      return c.cmd.slice(input.length);
    }
  }
  return null;
}

