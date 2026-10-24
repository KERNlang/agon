import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(import.meta.dirname, '../..');
const npmCache = mkdtempSync(join(tmpdir(), 'agon-s4-npm-cache-'));
process.on('exit', () => rmSync(npmCache, { recursive: true, force: true }));
const names = [
  'engine-runtime', 'persistence', 'dedup', 'browser-bridge', 'saas-api',
  'engine-catalog', 'verification', 'panel', 'worktree', 'agent-runtime', 'judge',
];
const assets = {
  'engine-runtime': ['engines/', 'python/', 'patches/'],
  persistence: ['python/history-search.py'],
  dedup: ['python/classifier.py', 'python/embedder.py', 'python/syntax-validator.py'],
  verification: ['python/'],
  'saas-api': ['python/'],
};

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', env: { ...process.env, npm_config_ignore_scripts: 'true', npm_config_cache: npmCache } });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`);
  }
  return result.stdout;
}

run(process.execPath, ['scripts/spec/generate-modular-support-package-metadata.mjs', '--check']);
const receipt = { schemaVersion: 1, packages: [] };
for (const name of names) {
  const workspace = `packages/support-${name}`;
  run('npm', ['run', 'build', '-w', workspace]);
  const raw = run('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], resolve(root, workspace));
  const packed = JSON.parse(raw)[0];
  const files = packed.files.map((entry) => entry.path).sort();
  for (const required of ['package.json', 'dist/index.js', 'dist/index.d.ts']) {
    if (!files.includes(required)) throw new Error(`${name}: packed artifact missing ${required}`);
  }
  for (const prefix of assets[name] ?? []) {
    if (!files.some((path) => prefix.endsWith('/') ? path.startsWith(prefix) : path === prefix)) {
      throw new Error(`${name}: packed artifact missing ${prefix}`);
    }
  }
  const forbidden = files.filter((path) => /(^|\/)(?:src|tests?|fixtures|node_modules|\.env|credentials|history|cache)(\/|$)/.test(path));
  if (forbidden.length) throw new Error(`${name}: forbidden packed paths: ${forbidden.join(', ')}`);
  if (packed.unpackedSize > 8 * 1024 * 1024) throw new Error(`${name}: unpacked size ${packed.unpackedSize} exceeds 8 MiB`);
  receipt.packages.push({
    id: `@kernlang/agon-support-${name}`,
    filename: packed.filename,
    integrity: packed.integrity,
    shasum: packed.shasum,
    fileCount: files.length,
    unpackedSize: packed.unpackedSize,
  });
}
console.log(JSON.stringify(receipt, null, 2));
