import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const expected = new Map([
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
]);

const legacyAdapters = new Map([
  ['packages/core/src/api/agent-loop.ts', 'agent-runtime'],
  ['packages/core/src/cesar/agent-session.ts', 'agent-runtime'],
  ['packages/core/src/blocks/syntax-validator-bridge.ts', 'browser-bridge'],
  ['packages/core/src/blocks/dedup-resolver.ts', 'dedup'],
  ['packages/core/src/signals/engine-registry.ts', 'engine-catalog'],
  ['packages/core/src/signals/engine-health.ts', 'engine-runtime'],
  ['packages/core/src/signals/chat-store.ts', 'persistence'],
  ['packages/core/src/sessions/history-search-bridge.ts', 'persistence'],
  ['packages/core/src/guards/guard-types.ts', 'verification'],
  ['packages/core/src/blocks/worktree-session.ts', 'worktree'],
  ['packages/forge/src/health-check.ts', 'panel'],
  ['packages/cli/src/cesar/judge.ts', 'judge'],
]);

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : [path];
  });
}

function inspect(definitions = expected) {
  const errors = [];
  for (const [name, dependencies] of definitions) {
    const directory = join(root, 'packages', `support-${name}`);
    const packageJsonPath = join(directory, 'package.json');
    if (!existsSync(packageJsonPath)) {
      errors.push(`missing package: support-${name}`);
      continue;
    }
    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    const expectedName = `@kernlang/agon-support-${name}`;
    if (manifest.name !== expectedName) errors.push(`${name}: wrong package name ${manifest.name}`);
    if (manifest.dependencies?.['@kernlang/agon-kernel']) errors.push(`${name}: kernel must be a peer, not a runtime dependency`);
    if (!manifest.peerDependencies?.['@kernlang/agon-kernel']) errors.push(`${name}: missing kernel peer contract`);
    const actualSupportDeps = Object.keys(manifest.dependencies ?? {})
      .filter((id) => id.startsWith('@kernlang/agon-support-'))
      .map((id) => id.slice('@kernlang/agon-support-'.length))
      .sort();
    const wanted = [...dependencies].sort();
    if (JSON.stringify(actualSupportDeps) !== JSON.stringify(wanted)) {
      errors.push(`${name}: support dependencies ${actualSupportDeps.join(',')} != ${wanted.join(',')}`);
    }
    const metadata = readFileSync(join(directory, 'src/package-metadata.ts'), 'utf8');
    if (/capabilities:\s*Object\.freeze\(\[\]\)/.test(metadata)) errors.push(`${name}: capability descriptor is empty`);

    for (const source of walk(join(directory, 'src')).filter((path) => path.endsWith('.ts'))) {
      const text = readFileSync(source, 'utf8');
      if (/export\s+function\s+configure[A-Z][A-Za-z0-9]*Runtime\s*\(/.test(text)) {
        errors.push(relative(root, source) + ": process-global runtime configurator crosses the package boundary");
      }
      for (const match of text.matchAll(/(?:from\s+|import\s*)['"]([^'"]+)['"]/g)) {
        const specifier = match[1];
        if (/^@kernlang\/agon-(?:core|cli|forge|dedup)$/.test(specifier)) {
          errors.push(`${relative(root, source)}: private legacy import ${specifier}`);
        }
        if (specifier.startsWith('.')) {
          const target = resolve(dirname(source), specifier);
          if (!(target === directory || target.startsWith(directory + sep))) {
            errors.push(`${relative(root, source)}: relative import escapes package (${specifier})`);
          }
        }
      }
    }
  }

  for (const [path, owner] of legacyAdapters) {
    const absolute = join(root, path);
    if (!existsSync(absolute)) {
      errors.push(`missing compatibility adapter: ${path}`);
      continue;
    }
    const text = readFileSync(absolute, 'utf8');
    if (!text.includes(`@kernlang/agon-support-${owner}`)) errors.push(`${path}: does not bind support-${owner}`);
  }

  const assetOwners = [
    ['packages/support-persistence/python/history-search.py', true],
    ['packages/support-dedup/python/history-search.py', false],
    ['packages/support-dedup/python/classifier.py', true],
    ['packages/support-dedup/python/embedder.py', true],
    ['packages/support-dedup/python/syntax-validator.py', true],
    ['packages/support-saas-api/python/routes/get_health.py', true],
  ];
  for (const [path, shouldExist] of assetOwners) {
    if (existsSync(join(root, path)) !== shouldExist) errors.push(`${path}: expected exists=${shouldExist}`);
  }
  return errors;
}

const errors = inspect();
if (process.argv.includes('--self-test')) {
  const mutated = new Map(expected);
  mutated.set('judge', ['panel']);
  const mutationErrors = inspect(mutated);
  if (!mutationErrors.some((error) => error.includes('judge: support dependencies'))) {
    throw new Error('negative control failed: dependency mutation survived');
  }
  if (!/export\s+function\s+configure[A-Z][A-Za-z0-9]*Runtime\s*\(/.test("export function configureFakeRuntime(runtime: unknown): void {}")) {
    throw new Error("negative control failed: mutable runtime configurator survived");
  }
}
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`verified ${expected.size} support-package boundaries, ${legacyAdapters.size} compatibility adapters, assets, and kernel uniqueness`);
