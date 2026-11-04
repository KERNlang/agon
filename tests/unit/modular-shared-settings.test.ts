import { describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import * as kernel from '../../packages/mod-kernel/src/index.js';
import * as persistence from '../../packages/support-persistence/src/index.js';
import * as browser from '../../packages/support-browser-bridge/src/index.js';
import { setupTestAgonHome, cleanupTestAgonHome, agonHomePath } from '../helpers/agon-home.js';

vi.mock('@kernlang/agon-kernel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kernlang/agon-kernel')>();
  return { ...actual, normalizeKernelSettings: vi.fn(actual.normalizeKernelSettings) };
});
vi.mock('@kernlang/agon-support-browser-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@kernlang/agon-support-browser-bridge')>();
  return { ...actual, normalizeBrowserSettings: vi.fn(actual.normalizeBrowserSettings) };
});

describe('shared configuration ownership', () => {
  it('provides exactly the settings assigned to each physical owner', () => {
    const ledger = JSON.parse(readFileSync(new URL('../../docs/specs/evidence/modular-agon-ownership.json', import.meta.url), 'utf8'));
    for (const [owner, defaults] of [
      ['@kernlang/agon-kernel', kernel.DEFAULT_KERNEL_SETTINGS],
      ['@kernlang/agon-support-persistence', persistence.DEFAULT_PERSISTENCE_SETTINGS],
      ['@kernlang/agon-support-browser-bridge', browser.DEFAULT_BROWSER_SETTINGS],
    ] as const) {
      expect(defaults).toBeDefined();
      const keys = ledger.assignments.filter((entry: { category: string; package: string }) =>
        entry.category === 'configKeys' && entry.package === owner
      ).map((entry: { id: string }) => entry.id).sort();
      expect(Object.keys(defaults).sort()).toEqual(keys);
    }
  });

  it('Core composes physical defaults and delegates normalization to the owners', async () => {
    const home = setupTestAgonHome('shared-settings-owner');
    try {
      const kernelOwner = await import('@kernlang/agon-kernel');
      const persistenceOwner = await import('@kernlang/agon-support-persistence');
      const browserOwner = await import('@kernlang/agon-support-browser-bridge');
      const { DEFAULT_AGON_CONFIG } = await import('../../packages/core/src/models/types.js');
      for (const defaults of [kernelOwner.DEFAULT_KERNEL_SETTINGS, persistenceOwner.DEFAULT_PERSISTENCE_SETTINGS, browserOwner.DEFAULT_BROWSER_SETTINGS]) {
        for (const [key, value] of Object.entries(defaults)) {
          expect(DEFAULT_AGON_CONFIG[key as keyof typeof DEFAULT_AGON_CONFIG]).toBe(value);
        }
      }
      writeFileSync(agonHomePath('config.json'), JSON.stringify({
        browserExtensionIds: 'wrong', uiMotion: 'wrong', terminalMode: 'wrong',
        hooks: 'wrong', allowedCommands: null, toolPermissions: 'wrong', permissionMode: '',
        permissions: { allow: ['Read(*)', 1], deny: ['Bash(rm:*)'] },
      }));
      const { loadConfig } = await import('../../packages/core/src/signals/config.js');
      const config = loadConfig();
      expect(kernelOwner.normalizeKernelSettings).toHaveBeenCalledTimes(1);
      expect(browserOwner.normalizeBrowserSettings).toHaveBeenCalledTimes(1);
      expect(config.browserExtensionIds).toEqual([]);
      expect(config.uiMotion).toBe('reduced');
      expect(config.terminalMode).toBe('auto');
      expect(config.hooks).toEqual({});
      expect(config.allowedCommands).toEqual([]);
      expect(config.toolPermissions).toEqual({ Read: 'allow', Grep: 'allow', Glob: 'allow', Edit: 'ask', Write: 'ask', Bash: 'ask' });
      expect(config.permissionMode).toBe('smart');
      expect(config.permissions).toEqual({ allow: ['Read(*)'], deny: ['Bash(rm:*)'] });
    } finally { cleanupTestAgonHome(home); }
  });

  it('retains and deduplicates permission rules from every scope in order', () => {
    const config = structuredClone(kernel.DEFAULT_KERNEL_SETTINGS);
    kernel.normalizeKernelSettings(config,
      { permissions: { allow: ['Read(*)'], deny: ['Bash(rm:*)'] } },
      { permissions: { allow: ['Read(*)', 'Grep(*)'], deny: ['Bash(git push:*)'] } },
      { permissions: { deny: ['Bash(rm:*)', 'Bash(npm publish:*)'] } },
    );
    expect(config.permissions).toEqual({
      allow: ['Read(*)', 'Grep(*)'], deny: ['Bash(rm:*)', 'Bash(git push:*)', 'Bash(npm publish:*)'],
    });
  });

  it.each([null, false, '', [], { allow: 'invalid', deny: [false, 'Bash(*)'] }])('retains the old malformed permission handling: %j', (permissions) => {
    const config = structuredClone(kernel.DEFAULT_KERNEL_SETTINGS);
    const scope = { permissions } as unknown as Partial<kernel.KernelSettings>;
    kernel.normalizeKernelSettings(config, scope, {}, {});
    expect(config.permissions).toEqual({ allow: [], deny: permissions && !Array.isArray(permissions) && typeof permissions === 'object' ? ['Bash(*)'] : [] });
  });
});
