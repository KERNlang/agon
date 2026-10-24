import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const scratchRoot = mkdtempSync(join(tmpdir(), 'agon-mod-pack-'));
const fixtureRoot = mkdtempSync(join(tmpdir(), 'agon-mod-api-external-'));
const npmEnv = {
  ...process.env,
  npm_config_cache: join(scratchRoot, 'npm-cache'),
  npm_config_ignore_scripts: 'true',
};

try {
  const packages = [
    { workspace: 'packages/mod-api', name: '@kernlang/agon-mod-api' },
    { workspace: 'packages/mod-kernel', name: '@kernlang/agon-kernel' },
  ];

  for (const subject of packages) {
    const output = execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--dry-run', '-w', subject.workspace], { cwd: root, encoding: 'utf8', env: npmEnv });
    const report = JSON.parse(output)[0];
    const paths = report.files.map(({ path }) => path);
    if (!paths.includes('package.json') || !paths.some((path) => path.endsWith('.d.ts')) || !paths.some((path) => path.endsWith('.js'))) {
      throw new Error(`${subject.name} pack is missing package metadata, declarations, or ESM runtime`);
    }
    const forbidden = paths.filter((path) => path.startsWith('src/') || path.includes('node_modules/') || path.includes('.tsbuildinfo'));
    if (forbidden.length) throw new Error(`${subject.name} pack contains development/private files: ${forbidden.join(', ')}`);
    console.log(`${subject.name}: ${paths.length} files, ${report.size} packed bytes, ${report.unpackedSize} unpacked bytes`);
  }

  const authoritativeSchemaRoot = resolve(root, 'docs/specs/schemas');
  const packageSchemaRoot = resolve(root, 'packages/mod-api/schemas');
  for (const schemaFile of readdirSync(authoritativeSchemaRoot).filter((name) => name.endsWith('.schema.json')).sort()) {
    const authoritative = readFileSync(join(authoritativeSchemaRoot, schemaFile));
    const packaged = readFileSync(join(packageSchemaRoot, schemaFile));
    if (!authoritative.equals(packaged)) throw new Error(`packaged schema drift: `);
  }
  console.log('packaged schemas match frozen authoritative schemas');

  mkdirSync(join(fixtureRoot, 'node_modules', '@kernlang'), { recursive: true });
  symlinkSync(resolve(root, 'packages/mod-api'), join(fixtureRoot, 'node_modules', '@kernlang', 'agon-mod-api'), 'dir');
  writeFileSync(join(fixtureRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  writeFileSync(join(fixtureRoot, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      strict: true,
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      noEmit: true,
      skipLibCheck: false,
    },
    include: ['example.ts'],
  }));
  writeFileSync(join(fixtureRoot, 'example.ts'), `
import { AGON_MOD_API_VERSION, validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory } from '@kernlang/agon-mod-api';
const createMod: AgonModFactory = async () => ({ apiVersion: '1', activate() {} });
void createMod;
void AGON_MOD_API_VERSION;
void validateManifest;
`);
  execFileSync(resolve(root, 'node_modules/.bin/tsc'), ['-p', join(fixtureRoot, 'tsconfig.json')], { cwd: fixtureRoot, stdio: 'inherit' });
  const apiPackage = JSON.parse(readFileSync(resolve(root, 'packages/mod-api/package.json'), 'utf8'));
  if (Object.keys(apiPackage.exports).some((entry) => entry.includes('internal'))) throw new Error('Mod API exports a private path');
  console.log('external compile-only Mod API fixture: passed');
} finally {
  rmSync(fixtureRoot, { recursive: true, force: true });
  rmSync(scratchRoot, { recursive: true, force: true });
}
