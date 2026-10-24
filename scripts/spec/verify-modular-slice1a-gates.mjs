import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { boundEvidenceOutput, computeSubjectHash, findUntrackedSubjectFiles, sha256, validateReviewEvidence } from './slice1a-qualification-gates.mjs';

const temp = mkdtempSync(join(tmpdir(), 'agon-slice1a-gate-self-test-'));
try {
  const secondArtifact = join(temp, 'review-two.txt');
  writeFileSync(secondArtifact, 'second independent review artifact');
  const artifact = join(temp, 'review.txt');
  writeFileSync(artifact, 'independent review artifact');
  const subjectHash = sha256('subject');
  const largeOutput = `head-${'α'.repeat(1_000)}-tail`;
  const boundedOutput = boundEvidenceOutput(largeOutput, 512);
  assert.equal(boundedOutput.truncated, true);
  assert.equal(boundedOutput.originalHash, sha256(largeOutput));
  assert.ok(Buffer.byteLength(boundedOutput.text) <= 512);
  assert.ok(boundedOutput.text.startsWith('head-'));
  assert.ok(boundedOutput.text.endsWith('-tail'));
  assert.deepEqual(boundEvidenceOutput('small', 512), { text: 'small', truncated: false, originalBytes: 5, originalHash: sha256('small') });
  assert.throws(() => boundEvidenceOutput('x', 511), /at least 512/);
  const valid = {
    schemaVersion: 1, subjectHash, disposition: 'passed', findings: [],
    runs: [
      { engine: 'one', status: 'completed', artifacts: [{ path: artifact, hash: sha256('independent review artifact') }] },
      { engine: 'two', status: 'completed', artifacts: [{ path: secondArtifact, hash: sha256('second independent review artifact') }] },
    ],
  };
  assert.equal(validateReviewEvidence(valid, subjectHash).passed, true);
  assert.equal(validateReviewEvidence({ ...valid, runs: valid.runs.map((run) => ({ ...run, artifacts: [{ path: artifact, hash: sha256('independent review artifact') }] })) }, subjectHash).passed, false);
  assert.equal(validateReviewEvidence('No blocking or important finding remains', subjectHash).passed, false);
  assert.equal(validateReviewEvidence({ ...valid, subjectHash: sha256('other') }, subjectHash).passed, false);
  assert.equal(validateReviewEvidence({ ...valid, runs: valid.runs.slice(0, 1) }, subjectHash).passed, false);
  assert.equal(validateReviewEvidence({ ...valid, runs: valid.runs.map((run) => ({ ...run, engine: 'same' })) }, subjectHash).passed, false);
  assert.equal(validateReviewEvidence({ ...valid, findings: [{ status: 'open' }] }, subjectHash).passed, false);
  assert.equal(validateReviewEvidence({ ...valid, findings: [{ status: 'deferred', externalBlocker: false }] }, subjectHash).passed, false);
  assert.equal(validateReviewEvidence({ ...valid, runs: valid.runs.map((run) => ({ ...run, artifacts: [{ path: artifact, hash: sha256('tampered') }] })) }, subjectHash).passed, false);

  const brokenArtifact = join(temp, 'broken-review.txt');
  symlinkSync(join(temp, 'missing-review.txt'), brokenArtifact);
  const brokenArtifactReview = { ...valid, runs: [{ ...valid.runs[0], artifacts: [{ path: brokenArtifact, hash: sha256('missing') }] }, valid.runs[1]] };
  assert.equal(validateReviewEvidence(brokenArtifactReview, subjectHash).passed, false);

  assert.equal(spawnSync('git', ['init', '-q'], { cwd: temp }).status, 0);
  mkdirSync(join(temp, 'tests/unit'), { recursive: true });
  writeFileSync(join(temp, 'package.json'), '{}\n');
  writeFileSync(join(temp, 'tests/unit/modular-hidden.test.ts'), 'export {};\n');
  assert.deepEqual(findUntrackedSubjectFiles(temp), ['package.json', 'tests/unit/modular-hidden.test.ts']);
  assert.equal(spawnSync('git', ['add', 'package.json', 'tests/unit/modular-hidden.test.ts'], { cwd: temp }).status, 0);
  assert.deepEqual(findUntrackedSubjectFiles(temp), []);

  for (const directory of ['packages/mod-api', 'packages/mod-kernel', 'scripts/spec', 'docs/specs', 'tests/spec', 'tests/helpers']) {
    mkdirSync(join(temp, directory), { recursive: true });
  }
  for (const file of ['.gitignore', 'package-lock.json', 'tsconfig.json', 'tests/helpers/modular-agon.ts']) writeFileSync(join(temp, file), '\n');
  symlinkSync(artifact, join(temp, 'packages/mod-api/escaped-link'));
  assert.throws(() => computeSubjectHash(temp), /symbolic link is not allowed/);
  console.log('qualification gate negative controls passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
