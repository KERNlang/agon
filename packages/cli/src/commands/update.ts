import { defineCommand } from 'citty';
import { bold, fail, info, success } from '../blocks/output-format.js';
import { VERSION } from '../blocks/engine.js';
import { checkForUpdate, newerReleaseInstruction } from '../services/update-check.js';
import { runManagedSetup } from './setup.js';

export const DEFAULT_UPDATE_PACKAGE = '@kernlang/agon';

export async function runManagedUpdate(version: string | undefined, options: { plan?: boolean; offline?: boolean; cache?: string } = {}): Promise<number> {
  const requested = version?.trim() || 'latest';
  if (requested !== 'latest' && requested !== VERSION) {
    throw new Error(`This release can transactionally update only to its bundled release set (${VERSION}), not ${requested}.`);
  }
  // A release can only stage the set pinned in its own channel, so a newer version needs the newer launcher first.
  if (requested === 'latest' && !options.offline) {
    const probed = await checkForUpdate(VERSION, undefined);
    if (probed.hasUpdate) {
      console.log(newerReleaseInstruction(probed.latestVersion));
      return 1;
    }
  }
  await runManagedSetup({ plan: options.plan, offline: options.offline, cache: options.cache }, { preserveExistingState: true });
  return 0;
}

export const updateCommand: any = defineCommand({
  meta: { name: 'update', description: 'Stage, verify, and atomically select a Modular Agon release without overwriting the running process.' },
  args: {
    version: { type: 'positional', description: 'Specific bundled release-set version. Omit for latest.', required: false },
    check: { type: 'boolean', description: 'Only check the registry; do not stage or select anything.', default: false },
    plan: { type: 'boolean', description: 'Print the exact transactional update plan without applying it.', default: false },
    offline: { type: 'boolean', description: 'Require a complete local npm cache with no network fallback.', default: false },
    cache: { type: 'string', description: 'Isolated npm cache directory used for candidate staging.' },
  },
  async run({ args }: { args: { version?: string; check?: boolean; plan?: boolean; offline?: boolean; cache?: string } }) {
    if (args.check) {
      const probed = await checkForUpdate(VERSION, undefined);
      if (probed.error && !probed.hasUpdate) { fail(`Could not reach the npm registry: ${probed.error}`); process.exitCode = 1; return; }
      if (probed.hasUpdate) {
        info(`Update available: ${bold(probed.currentVersion)} → ${bold(probed.latestVersion)}`);
        info(newerReleaseInstruction(probed.latestVersion));
      } else success(`Already on the latest version (${bold(probed.latestVersion)}).`);
      return;
    }
    process.exitCode = await runManagedUpdate(args.version, args);
  },
});
