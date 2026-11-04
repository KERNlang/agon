import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateManifest } from '../../docs/specs/fixtures/modular-agon-contracts/contracts.mjs';

const root = resolve(import.meta.dirname, '../..');
const example = join(root, 'docs/specs/fixtures/modular-agon-contracts/example-mod');
const temp = mkdtempSync(join(tmpdir(), 'agon-mod-pack-check-'));
try {
  const manifest = validateManifest(JSON.parse(readFileSync(join(example, 'agon.mod.json'), 'utf8')));
  for (const path of manifest.pack.include) {
    if (path.startsWith('/') || path.split('/').includes('..')) throw new Error(`unsafe pack path: ${path}`);
  }
  cpSync(join(example, 'package.json'), join(temp, 'package.json'));
  cpSync(join(example, 'agon.mod.json'), join(temp, 'agon.mod.json'));
  mkdirSync(join(temp, 'dist'), { recursive: true });
  writeFileSync(join(temp, 'dist/index.js'), 'export default async () => ({ apiVersion: "1", activate() {} });\n');
  writeFileSync(join(temp, 'dist/index.d.ts'), 'declare const factory: unknown; export default factory;\n');
  const npmCache = join(temp, 'npm-cache');
  mkdirSync(npmCache, { recursive: true });
  const packed = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: temp,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: npmCache, npm_config_update_notifier: 'false' },
  });
  if (packed.status !== 0) throw new Error(packed.stderr || packed.stdout);
  const files = JSON.parse(packed.stdout)[0].files.map((entry) => entry.path).sort();
  const expected = [...manifest.pack.include, 'package.json'].sort();
  if (JSON.stringify(files) !== JSON.stringify(expected)) throw new Error(`pack mismatch\nexpected ${expected.join(', ')}\nactual ${files.join(', ')}`);
  console.log(JSON.stringify({ status: 'passed', files, temporaryPackage: basename(temp) }));
} finally {
  rmSync(temp, { recursive: true, force: true });
}
