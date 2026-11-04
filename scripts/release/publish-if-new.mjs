import { execFileSync } from 'node:child_process';

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

function publishArgs(tarball, { dryRun = false, provenance = false }) {
  return ['publish', tarball, '--access', 'public',
    ...(provenance ? ['--provenance'] : []), ...(dryRun ? ['--dry-run'] : [])];
}

export function publishIfNew({ name, version, integrity }, tarball, options = {}) {
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
