import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const receiptPath = 'docs/specs/evidence/modular-agon-slice3-verification-receipt.json';
const expectedSubject = 'sha256:51ac3696585f273c3a65910472e84a35562f916a67faefa7abf58c1b9072d503';
const legacyImplementations = [
  'packages/core/src/blocks/file-history.ts',
  'packages/core/src/sessions/event-log.ts',
  'packages/core/src/blocks/dedup-resolver.ts',
  'packages/core/src/blocks/worktree-session.ts',
  'packages/forge/src/health-check.ts',
  'packages/cli/src/bridge/browser-host.ts',
  'packages/cli/src/cesar/judge.ts',
];

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function findQualifiedSlice3(revisions = git(['rev-list', 'HEAD']).trim().split('\n')) {
  for (const revision of revisions) {
    try {
      const receipt = JSON.parse(git(['show', `${revision}:${receiptPath}`]));
      if (receipt.qualification === 'modular-agon-slice3-clean-checkout' && receipt.passed === true && receipt.subject?.hash === expectedSubject) {
        const tree = git(['ls-tree', '-r', '--name-only', revision, '--', 'packages']).trim().split('\n');
        if (!tree.some((path) => path.startsWith('packages/support-'))) return revision;
      }
    } catch {
      // The receipt did not exist yet or was not the qualified S3 receipt.
    }
  }
  return null;
}

function verify(revisions) {
  const revision = findQualifiedSlice3(revisions);
  if (!revision) throw new Error('retained qualified S3 subject was not found in history');

  const tree = git(['ls-tree', '-r', '--name-only', revision, '--', 'packages']).trim().split('\n');
  const residualPackages = tree.filter((path) => path.startsWith('packages/support-'));
  if (residualPackages.length) throw new Error(`S3 rollback subject contains S4 support packages: ${residualPackages.join(', ')}`);

  for (const path of legacyImplementations) {
    const before = git(['show', `${revision}:${path}`]);
    if (before.includes('@kernlang/agon-support-')) throw new Error(`${path}: S3 rollback implementation depends on an S4 support package`);
    const after = readFileSync(resolve(root, path), 'utf8');
    if (!after.includes('@kernlang/agon-support-')) throw new Error(`${path}: S4 compatibility adapter is not bound to its physical support owner`);
  }
  return revision;
}

if (process.argv.includes('--self-test')) {
  if (findQualifiedSlice3(['0000000000000000000000000000000000000000']) !== null) {
    throw new Error('rollback negative control accepted a missing retained subject');
  }
  console.log('S4 rollback negative control passed');
} else {
  const revision = verify();
  console.log(`verified retained qualified S3 rollback subject ${revision.slice(0, 12)} and S4 adapter re-entry`);
}
