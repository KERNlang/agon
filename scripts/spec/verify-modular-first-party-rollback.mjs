import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const receiptPath = 'docs/specs/evidence/modular-agon-slice4-verification-receipt.json';
const expectedSubject = 'sha256:f7a94c449f40d61cfa4f54fd2f2a8081f5a7a5fddf3c842a179344952d2e0b81';
const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });

function findQualifiedSlice4(revisions = git(['rev-list', 'HEAD']).trim().split('\n')) {
  for (const revision of revisions) try {
    const receipt = JSON.parse(git(['show', `${revision}:${receiptPath}`]));
    if (receipt.qualification === 'modular-agon-slice4-clean-checkout' && receipt.passed === true && receipt.subject?.hash === expectedSubject) {
      const tree = git(['ls-tree', '-r', '--name-only', revision, '--', 'packages']).trim().split('\n');
      const hasS5 = tree.some((path) => path.startsWith('packages/mod-') && !path.startsWith('packages/mod-api/') && !path.startsWith('packages/mod-kernel/'));
      if (!hasS5) return revision;
    }
  } catch { /* receipt absent */ }
  return null;
}

function verify(revisions) {
  const revision = findQualifiedSlice4(revisions);
  if (!revision) throw new Error('retained qualified S4 subject was not found');
  const tree = git(['ls-tree', '-r', '--name-only', revision, '--', 'packages']).trim().split('\n');
  const unexpected = tree.filter((path) => path.startsWith('packages/mod-') && !path.startsWith('packages/mod-api/') && !path.startsWith('packages/mod-kernel/'));
  if (unexpected.length) throw new Error(`S4 rollback subject contains S5 mod packages: ${unexpected.join(', ')}`);
  const legacyRag = git(['show', `${revision}:packages/core/src/rag/store.ts`]);
  if (legacyRag.includes('@kernlang/agon-mod-rag')) throw new Error('retained S4 subject depends on S5 RAG owner');
  const currentAdapter = readFileSync(resolve(root, 'packages/core/src/rag/store.ts'), 'utf8');
  if (!currentAdapter.includes("from '@kernlang/agon-mod-rag'")) throw new Error('S5 RAG adapter cannot re-enter its physical owner');
  return revision;
}

if (process.argv.includes('--self-test')) {
  if (findQualifiedSlice4(['0000000000000000000000000000000000000000']) !== null) throw new Error('rollback negative control accepted a missing subject');
  console.log('S5 rollback negative control passed');
} else {
  const revision = verify();
  console.log(`verified retained qualified S4 rollback subject ${revision.slice(0, 12)} and S5 adapter re-entry`);
}
