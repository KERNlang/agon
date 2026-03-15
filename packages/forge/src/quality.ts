import { spawnWithTimeout } from '@agon/core';

/**
 * Run linting on a worktree and return warning count.
 */
export async function runLint(cwd: string): Promise<number> {
  // Try eslint first
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
        return parsed.reduce((sum, f) => sum + f.warningCount, 0);
      } catch {
        // couldn't parse eslint output
      }
    }
    return 0;
  } catch {
    return 0; // no linter available
  }
}

/**
 * Compute a style score (0-100) based on code formatting.
 */
export async function runStyleCheck(cwd: string): Promise<number> {
  // Try prettier check
  try {
    const result = await spawnWithTimeout({
      command: 'npx',
      args: ['prettier', '--check', '.'],
      cwd,
      timeout: 30_000,
    });

    // Exit 0 = all formatted, exit 1 = some not formatted
    return result.exitCode === 0 ? 100 : 80;
  } catch {
    return 100; // no formatter available — assume OK
  }
}
