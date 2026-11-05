import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export function publishedIntegrity(name, version) {
  let stdout;
  try {
    stdout = execFileSync('npm', ['view', `${name}@${version}`, 'dist.integrity', '--json'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const message = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    if (/E404|is not in this registry/i.test(message)) return null;
    throw new Error(`cannot query npm for ${name}@${version}: ${message.slice(0, 300)}`);
  }
  return stdout.trim() ? JSON.parse(stdout) : null;
}

export function assertTarballApproved({ name, version, integrity }, tarball) {
  const actual = `sha512-${createHash('sha512').update(readFileSync(tarball)).digest('base64')}`;
  if (actual !== integrity) {
    throw new Error(`${tarball} is not the tarball approved for ${name}@${version} (${actual}, manifest ${integrity}); refusing to publish`);
  }
}

function publishArgs(tarball, { dryRun = false, provenance = false }) {
  return ['publish', tarball, '--access', 'public',
    ...(provenance ? ['--provenance'] : []), ...(dryRun ? ['--dry-run'] : [])];
}

export function publishIfNew(entry, tarball, options = {}) {
  const { name, version, integrity } = entry;
  assertTarballApproved(entry, tarball);
  const existing = publishedIntegrity(name, version);
  if (existing === integrity) {
    console.log(`skip: ${name}@${version} already published with identical bytes`);
    return 'skipped';
  }
  if (existing) {
    throw new Error(`${name}@${version} is already on npm with different bytes (${existing}, packed ${integrity}); bump the version, npm versions are immutable`);
  }
  execFileSync('npm', publishArgs(tarball, options), { stdio: options.dryRun ? ['ignore', 'ignore', 'ignore'] : 'inherit' });
  console.log(`${options.dryRun ? 'dry-run' : 'published'}: ${name}@${version}`);
  return 'published';
}
