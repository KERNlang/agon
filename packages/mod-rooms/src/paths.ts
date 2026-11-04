import { join, resolve } from 'node:path';

export function runtimeAgonPath(...segments: string[]): string {
  const home = resolve(
    process.env.AGON_HOME?.trim() || resolve(process.env.HOME || '.', '.agon'),
  );
  return join(home, ...segments);
}
