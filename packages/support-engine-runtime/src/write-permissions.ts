/** These flags permit unattended writes from a CLI engine. */
export const WRITE_GRANTING_ARGS: string[] = ['--dangerously-skip-permissions', '--dangerously-bypass-approvals-and-sandbox', '--auto-approve', '--auto-commits', '--full-auto', '--yolo', '--yes', '-y'];

/** Check the arguments for the selected execution mode. */
export function seatGrantsWriteAccess(engine: unknown, mode: string): boolean {
  if (!engine || typeof engine !== 'object') return false;
  const modeCfg = (engine as Record<string, unknown>)[mode] as { args?: unknown } | undefined;
  const args = modeCfg && Array.isArray(modeCfg.args) ? (modeCfg.args as unknown[]) : [];
  return args.some((a) => typeof a === 'string' && WRITE_GRANTING_ARGS.includes(a));
}
