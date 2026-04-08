// @kern-source: ghost-text:1
export function getGhostCompletion(input: string, commands: Array<{cmd:string}>, engineIds?: string[]): string|null {
  if (!input || !input.startsWith('/')) return null;
  const lower = input.toLowerCase();
  
  // Phase 1: complete the command name itself
  for (const c of commands) {
    if (c.cmd.toLowerCase().startsWith(lower) && c.cmd.length > input.length) {
      return c.cmd.slice(input.length);
    }
  }
  
  // Phase 2: complete engine name after /use (/cesar opens picker instead)
  if (engineIds && engineIds.length > 0) {
    const cesarMatch = input.match(/^\/(use)\s+(\S*)$/i);
    if (cesarMatch) {
      const partial = cesarMatch[2].toLowerCase();
      for (const id of engineIds) {
        if (id.toLowerCase().startsWith(partial) && id.length > partial.length) {
          return id.slice(partial.length);
        }
      }
    }
  }
  
  return null;
}

