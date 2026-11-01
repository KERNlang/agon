import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';

import { agonHomePath, cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

let home = '';
afterEach(() => { vi.restoreAllMocks(); cleanupTestAgonHome(home); });

async function runConfigSet(key: string, value: string) {
  const { configCommand } = await import('../../packages/cli/src/commands/config.js');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
  await (configCommand as any).run({ args: { action: 'set', key, value } });
  return exit;
}

describe('agon config set for review timeouts', () => {
  it('defaults reviewMaxWallSeconds to 1800 and stores a numeric override', async () => {
    home = setupTestAgonHome('config-review-wall');
    const { loadConfig } = await import('../../packages/core/src/signals/config.js');
    const { resolveReviewMaxWallSeconds } = await import('../../packages/core/src/blocks/mod-dispatch-output.js');
    expect(resolveReviewMaxWallSeconds(loadConfig())).toBe(1800);
    const exit = await runConfigSet('reviewMaxWallSeconds', '2400');
    expect(exit).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(agonHomePath('config.json'), 'utf8'))).toMatchObject({ reviewMaxWallSeconds: 2400 });
    expect(resolveReviewMaxWallSeconds(loadConfig())).toBe(2400);
  });

  it('sets reviewTimeout as a number without a default that would shadow agentTimeout', async () => {
    home = setupTestAgonHome('config-review-timeout');
    const { loadConfig } = await import('../../packages/core/src/signals/config.js');
    const { resolveReviewTimeoutSeconds } = await import('../../packages/core/src/blocks/mod-dispatch-output.js');
    writeFileSync(agonHomePath('config.json'), JSON.stringify({ agentTimeout: 300 }));
    expect(loadConfig()).not.toHaveProperty('reviewTimeout');
    expect(resolveReviewTimeoutSeconds(loadConfig())).toBe(300);
    const exit = await runConfigSet('reviewTimeout', '900');
    expect(exit).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(agonHomePath('config.json'), 'utf8'))).toMatchObject({ reviewTimeout: 900, agentTimeout: 300 });
    expect(resolveReviewTimeoutSeconds(loadConfig())).toBe(900);
  });

  it('rejects a non-numeric reviewTimeout and an unknown key', async () => {
    home = setupTestAgonHome('config-review-reject');
    await expect(runConfigSet('reviewTimeout', 'soon')).rejects.toThrow('exit 1');
    await expect(runConfigSet('reviewTimeoutz', '9')).rejects.toThrow('exit 1');
  });

  it('gets an unset optional key as empty instead of unknown', async () => {
    home = setupTestAgonHome('config-review-get');
    const { configCommand } = await import('../../packages/cli/src/commands/config.js');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const exit = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => { throw new Error(`exit ${code}`); }) as never);
    await (configCommand as any).run({ args: { action: 'get', key: 'reviewMaxWallSeconds' } });
    expect(exit).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith('');
  });

  it('rejects prototype-chain names as config keys', async () => {
    home = setupTestAgonHome('config-review-proto');
    const { configSet } = await import('../../packages/core/src/signals/config.js');
    expect(() => configSet('toString' as never, 'x' as never)).toThrow('Unknown config key');
  });
});
