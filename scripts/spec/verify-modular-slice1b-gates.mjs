import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  collectSubjectContamination,
  hashGitSubject,
  isSourceBearingPath,
  validateDependencyGraph,
  validateSubjectBoundReview,
} from './slice1b-qualification-gates.mjs';

const git = (root, ...args) => {
  const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

const temp = mkdtempSync(join(tmpdir(), 'agon-slice1b-gates-'));
try {
  git(temp, 'init', '-q');
  git(temp, 'config', 'user.email', 'slice1b@example.invalid');
  git(temp, 'config', 'user.name', 'Slice 1B Fixture');
  mkdirSync(join(temp, 'src'), { recursive: true });
  mkdirSync(join(temp, 'evidence'), { recursive: true });
  writeFileSync(join(temp, '.gitignore'), 'src/ignored.ts\n');
  writeFileSync(join(temp, 'src/tracked.ts'), 'export const value = 1;\n');
  git(temp, 'add', '.gitignore', 'src/tracked.ts');
  git(temp, 'commit', '-qm', 'fixture');

  const commitHash = hashGitSubject(temp, { kind: 'commit', revision: 'HEAD', pathspecs: ['src', '.gitignore'] });
  writeFileSync(join(temp, 'src/tracked.ts'), 'export const value = 2;\n');
  git(temp, 'add', 'src/tracked.ts');
  const indexHash = hashGitSubject(temp, { kind: 'index', pathspecs: ['src', '.gitignore'] });
  assert.notEqual(indexHash, commitHash, 'index and commit object hashes must be distinct after a staged change');
  writeFileSync(join(temp, 'src/ignored.ts'), 'export const hidden = true;\n');
  writeFileSync(join(temp, 'src/untracked.ts'), 'export const hidden = true;\n');
  assert.deepEqual(collectSubjectContamination(temp, ['src', '.gitignore']), {
    ignored: ['src/ignored.ts'],
    untracked: ['src/untracked.ts'],
    unstaged: [],
  });

  const preReceiptLikeSourceHash = hashGitSubject(temp, { kind: 'index', pathspecs: ['src'], excludedPaths: ['evidence/receipt.json'] });
  writeFileSync(join(temp, 'src/bypass-review-evidence.json'), '{"active":true}\n');
  git(temp, 'add', 'src/bypass-review-evidence.json');
  const postReceiptLikeSourceHash = hashGitSubject(temp, { kind: 'index', pathspecs: ['src'], excludedPaths: ['evidence/receipt.json'] });
  assert.notEqual(postReceiptLikeSourceHash, preReceiptLikeSourceHash, 'receipt-like source names must remain bound to the subject');

  assert.equal(isSourceBearingPath('src/bypass-verification-receipt.json', { nonSourcePaths: ['evidence/receipt.json'] }), true);
  assert.equal(isSourceBearingPath('src/bypass-performance.json', { nonSourcePaths: ['evidence/receipt.json'] }), true);
  assert.equal(isSourceBearingPath('evidence/receipt.json', { nonSourcePaths: ['evidence/receipt.json'] }), false);

  assert.deepEqual(validateDependencyGraph([
    { id: 'a', dependencies: ['b', 'b'] },
    { id: 'b', dependencies: [] },
  ]), { declaredEdges: 2, uniqueEdges: 1, duplicateEdges: ['a->b'] });

  writeFileSync(join(temp, 'evidence/review-a.txt'), 'review A\n');
  writeFileSync(join(temp, 'evidence/review-b.txt'), 'review B\n');
  git(temp, 'add', 'evidence/review-a.txt', 'evidence/review-b.txt');
  const artifactHash = (path) => hashGitSubject(temp, { kind: 'index', pathspecs: [path], includePathsInHash: false });
  const review = {
    schemaVersion: 1,
    subject: { kind: 'index', hash: indexHash },
    disposition: 'passed',
    runs: [
      { engine: 'engine-a', status: 'completed', artifacts: [{ path: 'evidence/review-a.txt', hash: artifactHash('evidence/review-a.txt') }] },
      { engine: 'engine-b', status: 'completed', artifacts: [{ path: 'evidence/review-b.txt', hash: artifactHash('evidence/review-b.txt') }] },
    ],
    findings: [],
  };
  assert.equal(validateSubjectBoundReview(temp, review, { kind: 'index', hash: indexHash }).passed, true);
  assert.equal(validateSubjectBoundReview(temp, { ...review, runs: review.runs.map((run) => ({ ...run, engine: 'same' })) }, { kind: 'index', hash: indexHash }).passed, false);
  assert.equal(validateSubjectBoundReview(temp, { ...review, runs: [{ ...review.runs[0], artifacts: [{ path: '/tmp/absolute.txt', hash: 'sha256:bad' }] }, review.runs[1]] }, { kind: 'index', hash: indexHash }).passed, false);
  assert.equal(validateSubjectBoundReview(temp, { ...review, subject: { kind: 'commit', hash: indexHash } }, { kind: 'index', hash: indexHash }).passed, false);
  assert.equal(validateSubjectBoundReview(temp, { ...review, runs: [{ ...review.runs[0], artifacts: [{ ...review.runs[0].artifacts[0], hash: 'sha256:bad' }] }, review.runs[1]] }, { kind: 'index', hash: indexHash }).passed, false);
  console.log('Slice 1B qualification negative controls passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
