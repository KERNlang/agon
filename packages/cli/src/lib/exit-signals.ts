/** Install before command handlers. Let a command own its signal policy. */
export function installCliExitSignals(): () => void {
  const handlers = (['SIGINT', 'SIGTERM'] as const).map(signal => {
    const handler = (): void => {
      // Node's default signal exit skips JS exit hooks. Use process.exit so
      // the process owner can stop detached engine groups before this host ends.
      if (process.listeners(signal).some(listener => listener !== handler)) return;
      process.exit(signal === 'SIGINT' ? 130 : 143);
    };
    process.prependListener(signal, handler);
    return { signal, handler };
  });
  return () => {
    for (const { signal, handler } of handlers) process.removeListener(signal, handler);
  };
}
