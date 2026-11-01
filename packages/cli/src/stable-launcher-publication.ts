import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { DurableModHost, WriterFence, sha256Canonical, type GenerationPointer } from '@kernlang/agon-kernel';
import { containedBootstrapPrefix, hashBootstrapPayload, type StableBootstrap } from './stable-launcher-payload.js';

export async function publishStableLauncher(host: DurableModHost, pointer: GenerationPointer, prefix: string,
  source: string, verifyPayloads: () => Promise<boolean>): Promise<string> {
  const io = host.hostIo;
  const target = join(dirname(host.root), 'bin', 'agon');
  const temporary = `${target}.${randomUUID()}.tmp`;
  const fence = await WriterFence.acquire(join(host.root, 'locks', 'lifecycle-writer.json'),
    'agon.kernel.stable-launcher', { io });
  const errors: unknown[] = [];
  try {
    if (sha256Canonical(await host.readCurrentPointer()) !== sha256Canonical(pointer)) {
      throw new Error('selection changed before launcher publication; rerun setup');
    }
    const payloadHash = hashBootstrapPayload(containedBootstrapPrefix(realpathSync(host.root), prefix));
    if (!await verifyPayloads()) throw new Error('recovery bootstrap changed after qualification');
    const identity = { ownerId: 'agon.kernel.stable-launcher', artifactId: 'bin/agon',
      artifactHash: sha256Canonical({ generation: pointer.generation, prefix, payloadHash }) };
    const previous = (await host.activeArtifactGenerationLeases())
      .filter(lease => lease.ownerId === identity.ownerId && lease.artifactId === identity.artifactId);
    const reusable = previous.find(lease => lease.generation === pointer.generation && lease.artifactHash === identity.artifactHash);
    const lease = reusable ?? await host.leaseArtifactGeneration(pointer.generation, identity);
    const manifest = await host.validateGeneration(pointer.generation);
    const bootstrap: StableBootstrap = { hostPath: relative(dirname(host.root), host.root),
      prefix, generation: pointer.generation, kernelVersion: manifest.kernelVersion,
      payloadHash, leaseId: lease.leaseId, artifactHash: identity.artifactHash };
    const body = `#!/usr/bin/env node\nglobalThis.__agonBootstrap = ${JSON.stringify(bootstrap)};\n${source.replace(/^#![^\n]*\n/, '')}`;
    await io.mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await io.syncDirectory(dirname(dirname(target)));
    await io.writeFile(temporary, body, { flag: 'wx', mode: 0o700 });
    await io.syncFile(temporary);
    await fence.assertOwned();
    await io.rename(temporary, target);
    await io.syncDirectory(dirname(target));
    // Keep both generations if publication durability is uncertain.
    for (const old of previous) {
      if (old.leaseId !== lease.leaseId) await host.releaseArtifactGenerationLease(old.leaseId, {
        ownerId: old.ownerId, artifactId: old.artifactId, artifactHash: old.artifactHash,
      });
    }
    return target;
  } catch (error) { errors.push(error); throw error; }
  finally {
    try { await io.rm(temporary, { force: true }); } catch (error) { errors.push(error); }
    try { await fence.release(); } catch (error) { errors.push(error); }
    if (errors.length > 1) throw new AggregateError(errors, 'launcher publication or cleanup failed; retained recovery generations remain protected');
    if (errors.length === 1) throw errors[0];
  }
}
