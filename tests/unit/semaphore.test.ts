import { describe, it, expect } from 'vitest';
import { HEAVY_TOOL_PATTERN, isHeavyTool, Semaphore } from '../../packages/core/src/blocks/semaphore.js';

// Pins HEAVY_TOOL_PATTERN: the node-package runner arm (npm/yarn/pnpm + a
// heavy subcommand) is what actually serializes team members. A regression
// that only breaks that arm still leaves the tsc/cargo/pytest arm matching,
// so it must be asserted explicitly.

describe('isHeavyTool', () => {
  it('matches npm/yarn/pnpm heavy subcommands', () => {
    for (const cmd of [
      'npm test',
      'npm run test',
      'npm run typecheck',
      'npm run build',
      'npm install',
      'npm ci',
      'yarn install',
      'yarn test',
      'pnpm run build',
      'pnpm ci',
    ]) {
      expect(isHeavyTool(cmd), cmd).toBe(true);
    }
  });

  it('matches the standalone toolchain runners', () => {
    for (const cmd of ['tsc', 'cargo test', 'cargo build', 'pytest', 'go test ./...', 'mvn package', 'gradle build']) {
      expect(isHeavyTool(cmd), cmd).toBe(true);
    }
  });

  it('leaves cheap/read-only commands unserialized', () => {
    for (const cmd of ['ls -la', 'cat package.json', 'git status', 'echo npm test', 'npm-run-all', 'npmtest']) {
      expect(isHeavyTool(cmd), cmd).toBe(false);
    }
  });

  it('tolerates leading whitespace (the command is trimmed first)', () => {
    expect(isHeavyTool('   npm test  ')).toBe(true);
    expect(HEAVY_TOOL_PATTERN.test('npm test')).toBe(true);
  });
});

describe('Semaphore', () => {
  it('rejects a permit count below 1', () => {
    expect(() => new Semaphore(0)).toThrow(/permits must be >= 1/);
  });

  it('queues past the permit count and releases in order', async () => {
    const sem = new Semaphore(1);
    const order: string[] = [];
    await sem.acquire();
    const queued = sem.acquire().then(() => { order.push('second'); });
    order.push('first');
    sem.release();
    await queued;
    expect(order).toEqual(['first', 'second']);
  });
});
