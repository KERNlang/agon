import { beforeEach, expect, it, vi } from 'vitest';
import type { HandlerContext } from '../../packages/cli/src/handlers/types.js';

const effects = vi.hoisted(() => ({ exec: vi.fn(), commit: vi.fn(() => 'committed') }));
vi.mock('node:child_process', () => ({ execSync: effects.exec, execFileSync: effects.commit }));
vi.mock('@kernlang/agon-core', () => ({
  resolveWorkingDir: () => '/fixture', loadConfig: () => ({ commitCoAuthor: '' }),
  configGet: () => false, appendAttribution: (text: string) => text, appendCoAuthor: (text: string) => text,
}));
import { handleCommit } from '../../packages/cli/src/handlers/commit.js';

beforeEach(() => {
  vi.clearAllMocks();
  effects.exec.mockImplementation((command: string) => {
    if (command.includes('--name-only')) return 'fixture.ts';
    if (command === 'git status --short') return 'M  fixture.ts';
    return 'fix fixture';
  });
});

it.each(['', ' ', 'no', ' n ', 'NO', 'cancel'])('does not commit when confirmation is %j', async answer => {
  await handleCommit(undefined, vi.fn(), { askQuestion: async () => answer } as unknown as HandlerContext);
  expect(effects.commit).not.toHaveBeenCalled();
});

it.each(['y', ' YES ', 'fix: operator message', 'yikes', 'yes please'])('commits after explicit approval or message edit %j', async answer => {
  await handleCommit(undefined, vi.fn(), { askQuestion: async () => answer } as unknown as HandlerContext);
  expect(effects.commit).toHaveBeenCalledWith('git', ['commit', '-m', ['y', ' YES '].includes(answer) ? 'fix: fixture.ts' : answer], expect.anything());
});

it('preserves an explicit command message without another question', async () => {
  const askQuestion = vi.fn(() => { throw new Error('Unexpected approval question'); });
  await handleCommit('fix: explicit message', vi.fn(), { askQuestion } as unknown as HandlerContext);
  expect(askQuestion).not.toHaveBeenCalled();
  expect(effects.commit).toHaveBeenCalledWith('git', ['commit', '-m', 'fix: explicit message'], expect.anything());
});
