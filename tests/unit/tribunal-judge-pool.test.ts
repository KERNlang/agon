import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ROSTER = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];

const { runTribunalMock } = vi.hoisted(() => ({ runTribunalMock: vi.fn() }));

vi.mock('@kernlang/agon-forge', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@kernlang/agon-forge')>()),
  runTribunal: runTribunalMock,
}));

vi.mock('../../packages/cli/src/handlers/engine-filter.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../packages/cli/src/handlers/engine-filter.js')>()),
  filterDefaultOrchestrationEngines: () => [...ROSTER],
}));

import { tribunalCommand } from '../../packages/cli/src/commands/tribunal.js';
import { handleTribunal } from '../../packages/cli/src/handlers/tribunal.js';
import { cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

const emptyResult = { rounds: [], summary: 'summary', positions: [], panelHealth: { requested: 0, responded: 0, degraded: false, notes: [], banner: null } };

describe('tribunal entry points hand the run roster to the judge pool', () => {
  let home: string;
  const savedQuiet = process.env.AGON_QUIET;

  beforeEach(() => {
    home = setupTestAgonHome('tribunal-judge-pool');
    runTribunalMock.mockReset();
    runTribunalMock.mockResolvedValue(emptyResult);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (savedQuiet === undefined) delete process.env.AGON_QUIET; else process.env.AGON_QUIET = savedQuiet;
    cleanupTestAgonHome(home);
  });

  const runCommand = (engines?: string) => (tribunalCommand as any).run({
    args: { question: 'Ship it?', rounds: '1', mode: 'adversarial', protocol: 'auto', timeout: '5', quiet: true, ...(engines ? { engines } : {}) },
  });

  it('B2 agon tribunal -e alpha,beta allows only those two engines as judges', async () => {
    await runCommand('alpha,beta');
    expect(runTribunalMock).toHaveBeenCalledTimes(1);
    expect(runTribunalMock.mock.calls[0][0]).toMatchObject({ engines: ['alpha', 'beta'], judgePool: ['alpha', 'beta'] });
  });

  it('B2 agon tribunal on the default roster seats four engines and allows the whole roster as judges', async () => {
    await runCommand();
    expect(runTribunalMock.mock.calls[0][0]).toMatchObject({ engines: ROSTER.slice(0, 4), judgePool: ROSTER });
  });

  it('B2 /tribunal in a session allows its active roster as judges', async () => {
    mkdirSync(join(home, 'chats'), { recursive: true });
    const ctx = {
      activeEngines: () => [...ROSTER], config: {}, registry: {}, adapter: {}, chatSession: { id: 'judge-pool', messages: [] }, setActiveAbort: () => {},
    } as any;
    await handleTribunal('Ship it?', () => {}, ctx);
    expect(runTribunalMock.mock.calls[0][0]).toMatchObject({ engines: ROSTER.slice(0, 4), judgePool: ROSTER });
  });
});
