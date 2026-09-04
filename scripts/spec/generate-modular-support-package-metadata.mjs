import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const version = '1.0.0';
const packages = [
  ['engine-runtime', []],
  ['persistence', []],
  ['dedup', []],
  ['browser-bridge', []],
  ['saas-api', []],
  ['engine-catalog', ['engine-runtime']],
  ['verification', ['persistence']],
  ['panel', ['engine-runtime']],
  ['worktree', ['verification']],
  ['agent-runtime', ['engine-runtime', 'persistence', 'verification']],
  ['judge', ['panel', 'verification']],
];
const check = process.argv.includes('--check');
const capabilities = {
  'engine-runtime': ['engine-discovery', 'engine-health', 'engine-process', 'engine-auth', 'engine-isolation'],
  'engine-catalog': ['engine-registry', 'model-catalog', 'model-probe'],
  persistence: ['history', 'events', 'sessions', 'plans', 'locks', 'runs', 'history-search'],
  verification: ['guard-telemetry', 'checker-discovery', 'information-gain', 'shadow-verdicts'],
  worktree: ['plan-state', 'worktree-lock', 'worktree-session'],
  panel: ['panel-health', 'seat-dispatch'],
  judge: ['forge-judgment', 'forge-convergence'],
  'agent-runtime': ['agent-loop', 'agent-session'],
  dedup: ['dedup-sidecars'],
  'browser-bridge': ['syntax-validation'],
  'saas-api': ['saas-python-api'],
};

function canonical(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function emit(path, content) {
  if (check) {
    if (readFileSync(path, 'utf8') !== content) throw new Error(`generated support metadata is stale: ${path}`);
    return;
  }
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content);
}

for (const [name, dependencies] of packages) {
  const directory = join(root, 'packages', `support-${name}`);
  const packageName = `@kernlang/agon-support-${name}`;
  emit(join(directory, 'package.json'), canonical({
    name: packageName,
    version,
    private: false,
    license: 'MIT',
    type: 'module',
    exports: { '.': { types: './dist/index.d.ts', import: './dist/index.js' } },
    main: './dist/index.js',
    types: './dist/index.d.ts',
    files: ['dist', 'LICENSE', ...(name === 'engine-runtime' ? ['engines', 'python', 'patches'] : []), ...(name === 'dedup' ? ['python'] : []), ...(name === 'saas-api' ? ['python'] : []), ...(name === 'verification' ? ['python'] : []), ...(name === 'persistence' ? ['python'] : [])],
    sideEffects: false,
    scripts: { build: 'tsup && tsc -b tsconfig.json --force', typecheck: 'tsc --noEmit' },
    peerDependencies: { '@kernlang/agon-kernel': '>=0.0.0-0 <2' },
    dependencies: {
      ...Object.fromEntries(dependencies.map((dependency) => ['@kernlang/agon-support-' + dependency, version])),
      ...(name === 'engine-runtime' ? { zod: '^4.3.6' } : {}),
      ...(name === 'engine-catalog' ? { '@kernlang/agon-engines': '^0.1.2' } : {}),
      ...(name === 'persistence' ? { '@kernlang/agon-engines': '^0.1.2' } : {}),
    },
  }));
  emit(join(directory, 'LICENSE'), readFileSync(join(root, 'LICENSE'), 'utf8'));
  emit(join(directory, 'tsconfig.json'), canonical({
    extends: '../../tsconfig.base.json',
    compilerOptions: {
      composite: true,
      outDir: 'dist',
      rootDir: 'src',
      baseUrl: '.',
      paths: { '@kernlang/agon-kernel': ['../mod-kernel/src/index.ts'] },
      sourceMap: false,
      declarationMap: false,
      emitDeclarationOnly: true,
    },
    references: [{ path: '../mod-kernel' }, ...dependencies.map((dependency) => ({ path: '../support-' + dependency }))],
    include: ['src'],
  }));
  emit(join(directory, 'tsup.config.ts'), "import { defineConfig } from 'tsup';\n\nexport default defineConfig({ entry: ['src/index.ts'], format: ['esm'], dts: false, sourcemap: false, clean: true, target: 'es2022' });\n");
  emit(join(directory, 'src', 'package-metadata.ts'), `import type { SupportPackageDescriptor } from '@kernlang/agon-kernel';\n\nexport const SUPPORT_PACKAGE = Object.freeze({\n  schemaVersion: 1,\n  id: '${packageName}',\n  apiVersion: 1,\n  lifecycle: 'singleton-per-generation',\n  capabilities: Object.freeze(${JSON.stringify(capabilities[name])}),\n}) satisfies SupportPackageDescriptor;\n`);
  const indexPath = join(directory, 'src', 'index.ts');
  if (!check) {
    try { readFileSync(indexPath); } catch { emit(indexPath, "export { SUPPORT_PACKAGE } from './package-metadata.js';\n"); }
  } else {
    readFileSync(indexPath);
  }
}

console.log(`${check ? 'verified' : 'generated'} metadata for ${packages.length} support packages`);
