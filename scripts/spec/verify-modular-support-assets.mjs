import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const pairs = [];

function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? files(path) : [path];
  }).sort();
}

function mirror(source, target, filter = () => true) {
  for (const sourcePath of files(join(root, source)).filter(filter)) {
    pairs.push([sourcePath, join(root, target, relative(join(root, source), sourcePath))]);
  }
}

mirror('engines', 'packages/support-engine-runtime/engines');
mirror('packages/saas-api/src', 'packages/support-saas-api/python');
for (const name of ['classifier.py', 'embedder.py', 'install-python.mjs', 'requirements.txt', 'sidecar.py', 'syntax-validator.py']) {
  pairs.push([join(root, 'packages/dedup', name), join(root, 'packages/support-dedup/python', name)]);
}
pairs.push(
  [join(root, 'packages/dedup/history-search.py'), join(root, 'packages/support-persistence/python/history-search.py')],
  [join(root, 'packages/cli/py/agon-model-probe-wrapper.py'), join(root, 'packages/support-engine-runtime/python/agon-model-probe-wrapper.py')],
  [join(root, 'patches/@kernlang+agon-engines+0.1.3.patch'), join(root, 'packages/support-engine-runtime/patches/@kernlang+agon-engines+0.1.3.patch')],
  [join(root, 'packages/cli/py/agon-tui-probe.py'), join(root, 'packages/support-verification/python/agon-tui-probe.py')],
  [join(root, 'scripts/claude-tui-probe.py'), join(root, 'packages/support-verification/python/claude-tui-probe.py')],
  [join(root, 'packages/saas-api/requirements.txt'), join(root, 'packages/support-saas-api/python/requirements.txt')],
);

for (const [source, target] of pairs) {
  const canonical = readFileSync(source);
  const mirrorBytes = readFileSync(target);
  if (!canonical.equals(mirrorBytes)) throw new Error(`compatibility asset drift: ${relative(root, source)} != ${relative(root, target)}`);
}
console.log(`verified byte parity for ${pairs.length} canonical/compatibility asset pairs`);
