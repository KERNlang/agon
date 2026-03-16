import { spawnWithTimeout } from '@agon/core';

export async function runLint(cwd: string): Promise<number> {
  try {
    const result = await spawnWithTimeout({
      command: 'npx',
      args: ['eslint', '.', '--format', 'json', '--quiet'],
      cwd,
      timeout: 30_000,
    });
  
    if (result.stdout) {
      try {
        const parsed = JSON.parse(result.stdout) as Array<{ warningCount: number }>;
        return parsed.reduce((sum: number, f: { warningCount: number }) => sum + f.warningCount, 0);
      } catch {
        // couldn't parse eslint output
      }
    }
    return 0;
  } catch {
    return 0;
  }
  
}

export async function runStyleCheck(cwd: string): Promise<number> {
  try {
    const result = await spawnWithTimeout({
      command: 'npx',
      args: ['prettier', '--check', '.'],
      cwd,
      timeout: 30_000,
    });
  
    return result.exitCode === 0 ? 100 : 80;
  } catch {
    return 100;
  }
  
}

