import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DurableModHost, type GenerationLease } from '@kernlang/agon-kernel';
import { containedBootstrapPrefix, hashBootstrapPayload, type StableBootstrap } from './stable-launcher-payload.js';
import { recoverModTransactions } from './mod-transaction-recovery.js';

// Setup supplies this data only after qualification and retention succeed.
const bootstrap = (globalThis as typeof globalThis & { __agonBootstrap: StableBootstrap }).__agonBootstrap;
const home = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const host = resolve(home, bootstrap.hostPath);
let readerHost: DurableModHost | undefined;
let readerLease: GenerationLease | undefined;
try {
  const args = process.argv.slice(2);
  if (process.env.AGON_MOD_SAFE_MODE === '1' && args.length === 3
    && args[0] === 'mod' && args[1] === 'recover' && args[2] === 'transactions') {
    // This explicit kernel operation must repair locks before reader admission.
    console.log(JSON.stringify(await recoverModTransactions(host, bootstrap.kernelVersion), null, 2));
  } else {
    let prefix: string;
    if (process.env.AGON_MOD_SAFE_MODE === '1') {
      prefix = containedBootstrapPrefix(host, bootstrap.prefix);
      // Pin first. Collection cannot remove the payload while authority is checked.
      readerHost = new DurableModHost(host, { kernelVersion: bootstrap.kernelVersion });
      readerLease = await readerHost.leaseGeneration(bootstrap.generation, 'agon.kernel.stable-launcher.reader');
      const lease = JSON.parse(readFileSync(join(host, 'leases', `${bootstrap.leaseId}.json`), 'utf8'));
      if (lease.kind !== 'artifact' || lease.releasedAt !== null || lease.generation !== bootstrap.generation
        || lease.ownerId !== 'agon.kernel.stable-launcher' || lease.artifactId !== 'bin/agon'
        || lease.artifactHash !== bootstrap.artifactHash || hashBootstrapPayload(prefix) !== bootstrap.payloadHash) {
        throw new Error('retained recovery bootstrap no longer matches its qualified identity');
      }
    } else {
      const pointer = JSON.parse(readFileSync(join(host, 'current-generation.json'), 'utf8'));
      if (!Number.isSafeInteger(pointer.generation) || pointer.generation < 1) throw new Error('selected generation is invalid');
      const generation = join(host, 'generations', String(pointer.generation).padStart(16, '0'));
      const index = JSON.parse(readFileSync(join(generation, 'installed-index.json'), 'utf8'));
      prefix = containedBootstrapPrefix(host, index.installationPrefix);
    }
    const cli = join(prefix, 'node_modules', '@kernlang', 'agon', 'dist', 'index.js');
    const result = spawnSync(process.execPath, [cli, ...args], {
      stdio: 'inherit', env: { ...process.env, AGON_MODULAR_HOST_ROOT: host },
    });
    if (result.error) throw result.error;
    process.exitCode = result.status ?? 1;
  }
} catch (error) {
  console.error(`Agon launcher: ${error instanceof Error ? error.message : String(error)}`);
  console.error(process.env.AGON_MOD_SAFE_MODE === '1'
    ? 'Recovery did not finish. Retry the current launcher after setup completes. For a dead writer, use mod recover transactions; malformed locks need explicit operator inspection.'
    : 'Selection was not changed. Use AGON_MOD_SAFE_MODE=1 with mod recover to inspect and approve recovery.');
  process.exitCode = 1;
} finally {
  if (readerHost && readerLease) {
    try { await readerHost.releaseGenerationLease(readerLease.leaseId); }
    catch (error) {
      console.error(`Agon launcher: recovery reader cleanup failed; generation stays retained: ${String(error)}`);
      process.exitCode = 1;
    }
  }
}
