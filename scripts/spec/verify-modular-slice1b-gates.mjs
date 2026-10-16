import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  collectSubjectContamination,
  hashGitSubject,
  isSourceBearingPath,
  validateDependencyGraph,
  validateSubjectBoundReview,
  validateStoredSubjectBoundReview,
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
  git(temp, 'commit', '-qm', 'review artifacts');
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
  const acceptedInvalidReviews = [];
  for (const engine of [undefined, null, '', ' ', ' engine-a', 'engine-a ', 1, {}, []]) {
    const candidate = { ...review, runs: [{ ...review.runs[0], engine }, review.runs[1]] };
    if (validateSubjectBoundReview(temp, candidate, { kind: 'index', hash: indexHash }).passed) {
      acceptedInvalidReviews.push(`invalid engine: ${JSON.stringify(engine)}`);
    }
  }
  for (const path of ['.', 'evidence', 'evidence/*.txt', 'evidence/review-?.txt']) {
    const candidate = { ...review, runs: [{ ...review.runs[0], artifacts: [{ path, hash: artifactHash(path) }] }, review.runs[1]] };
    if (validateSubjectBoundReview(temp, candidate, { kind: 'index', hash: indexHash }).passed) {
      acceptedInvalidReviews.push(`nonliteral artifact: ${path}`);
    }
  }
  assert.deepEqual(acceptedInvalidReviews, [], 'review identity must name valid engine identifiers and exact files');
  const committedReview = { ...review, subject: { kind: 'commit', hash: indexHash } };
  const committedSubject = { kind: 'commit', revision: 'HEAD', hash: indexHash };
  assert.equal(validateSubjectBoundReview(temp, committedReview, committedSubject).passed, true);
  assert.equal(validateSubjectBoundReview(temp, { ...committedReview, runs: [
    { ...review.runs[0], artifacts: [{ path: 'evidence/*.txt', hash: artifactHash('evidence/*.txt') }] }, review.runs[1],
  ] }, committedSubject).passed, false);
  const literalPath = 'evidence/review-[literal].txt';
  writeFileSync(join(temp, literalPath), 'literal artifact\n');
  git(temp, 'add', '--', `:(literal)${literalPath}`);
  const literalReview = { ...review, runs: [
    { ...review.runs[0], artifacts: [{ path: literalPath, hash: artifactHash(`:(literal)${literalPath}`) }] }, review.runs[1],
  ] };
  assert.equal(validateSubjectBoundReview(temp, literalReview, { kind: 'index', hash: indexHash }).passed, true);
  assert.equal(validateSubjectBoundReview(temp, { ...review, runs: review.runs.map((run) => ({ ...run, engine: 'same' })) }, { kind: 'index', hash: indexHash }).passed, false);
  assert.equal(validateSubjectBoundReview(temp, { ...review, runs: [{ ...review.runs[0], artifacts: [{ path: '/tmp/absolute.txt', hash: 'sha256:bad' }] }, review.runs[1]] }, { kind: 'index', hash: indexHash }).passed, false);
  assert.equal(validateSubjectBoundReview(temp, { ...review, subject: { kind: 'commit', hash: indexHash } }, { kind: 'index', hash: indexHash }).passed, false);
  assert.equal(validateSubjectBoundReview(temp, { ...review, runs: [{ ...review.runs[0], artifacts: [{ ...review.runs[0].artifacts[0], hash: 'sha256:bad' }] }, review.runs[1]] }, { kind: 'index', hash: indexHash }).passed, false);
  writeFileSync(join(temp, 'evidence', 'review.json'), `${JSON.stringify(review)}\n`);
  git(temp, 'add', 'evidence/review.json');
  assert.equal(validateStoredSubjectBoundReview(temp, 'evidence/review.json', { kind: 'index', hash: indexHash }).passed, true);
  writeFileSync(join(temp, 'evidence', 'review.json'), `${JSON.stringify({ ...review, disposition: 'failed' })}\n`);
  assert.equal(validateStoredSubjectBoundReview(temp, 'evidence/review.json', { kind: 'index', hash: indexHash }).passed, true, 'ambient review bytes must not replace staged evidence');
  const identityDefects = [];
  for (const path of ['src/dist-custom/implementation.ts', 'packages/mod-plan/src/dist/hidden.ts', 'src/node_modules/hidden.ts']) {
    if (!isSourceBearingPath(path)) identityDefects.push(`hidden source: ${path}`);
  }
  for (const path of ['node_modules/dep/index.js', 'packages/mod-plan/dist/index.js', 'packages/cli/dist-tsc/index.js']) {
    assert.equal(isSourceBearingPath(path), false, 'known generated outputs remain exempt');
  }
  for (const name of ['a.ts', 'z.ts', 'ä.ts']) writeFileSync(join(temp, 'src', name), 'export {};\n');
  git(temp, 'add', 'src/a.ts', 'src/z.ts', 'src/ä.ts');
  const localeHashes = ['en_US.UTF-8', 'sv_SE.UTF-8'].map(locale => {
    const code = `import { hashGitSubject } from ${JSON.stringify(new URL('slice1b-qualification-gates.mjs', import.meta.url).href)}; console.log(hashGitSubject(${JSON.stringify(temp)}, {kind:'index',pathspecs:['src']}));`;
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', env: { ...process.env, LANG: locale, LC_ALL: locale } });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  });
  if (localeHashes[0] !== localeHashes[1]) identityDefects.push('locale-dependent subject hash');
  assert.deepEqual(identityDefects, [], 'subject identity must reject hidden source and ignore locale');
  const assessmentRoot = join(temp, 'assessment space');
  mkdirSync(join(assessmentRoot, 'scripts/spec'), { recursive: true });
  mkdirSync(join(assessmentRoot, 'docs/specs/evidence/receipts'), { recursive: true });
  for (const name of ['assess-modular-agon-slices.mjs', 'slice1b-qualification-gates.mjs']) {
    copyFileSync(new URL(name, import.meta.url), join(assessmentRoot, 'scripts/spec', name));
  }
  git(assessmentRoot, 'init', '-q');
  git(assessmentRoot, 'config', 'user.email', 'slice1b@example.invalid');
  git(assessmentRoot, 'config', 'user.name', 'Slice 1B Fixture');
  writeFileSync(join(assessmentRoot, '.gitignore'), 'hidden.ts\n');
  writeFileSync(join(assessmentRoot, 'package.json'), JSON.stringify({ scripts: { verify: 'true' } }));
  const sliceIds = ['S1B', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9'];
  const roadmapPath = 'docs/specs/evidence/modular-agon-implementation-roadmap.json';
  const fixtureSlices = sliceIds.map((id, index) => ({ id, dependsOn: index ? [sliceIds[index - 1]] : [], acceptanceCommands: ['npm run verify'] }));
  writeFileSync(join(assessmentRoot, roadmapPath), JSON.stringify({ slices: fixtureSlices }));
  git(assessmentRoot, 'add', '.');
  git(assessmentRoot, 'commit', '-qm', 'qualified source');
  const receiptPath = 'docs/specs/evidence/receipts/modular-agon-s1b.json';
  const dependentReceiptPath = 'docs/specs/evidence/receipts/modular-agon-s2.json';
  const sliceReceipt = { schemaVersion: 2, passed: true, cleanWorktree: true,
    subjectCommit: git(assessmentRoot, 'rev-parse', 'HEAD'),
    subjectHash: hashGitSubject(assessmentRoot, { kind: 'commit', pathspecs: ['.'], excludedPaths: sliceIds.map(id => `docs/specs/evidence/receipts/modular-agon-${id.toLowerCase()}.json`) }),
    commands: ['npm run verify'], prerequisites: {} };
  const saveReceipt = (value) => writeFileSync(join(assessmentRoot, receiptPath), JSON.stringify(value));
  const assess = () => spawnSync(process.execPath, ['scripts/spec/assess-modular-agon-slices.mjs'], { cwd: assessmentRoot, encoding: 'utf8' });
  saveReceipt(sliceReceipt);
  assert.equal(assess().status, 1, 'untracked receipts cannot qualify a slice');
  git(assessmentRoot, 'add', receiptPath);
  assert.equal(assess().status, 1, 'staged-only receipts cannot qualify a slice');
  git(assessmentRoot, 'commit', '-qm', 'record qualification');
  assert.deepEqual(JSON.parse(assess().stdout).readySlices, ['S1B']);
  let dependentReceipt;
  for (let index = 1; index < sliceIds.length; index += 1) {
    const previousId = sliceIds[index - 1];
    const previousPath = `docs/specs/evidence/receipts/modular-agon-${previousId.toLowerCase()}.json`;
    const path = `docs/specs/evidence/receipts/modular-agon-${sliceIds[index].toLowerCase()}.json`;
    const receipt = { ...sliceReceipt, subjectCommit: git(assessmentRoot, 'rev-parse', 'HEAD'),
      prerequisites: { [previousId]: git(assessmentRoot, 'rev-parse', `HEAD:${previousPath}`) } };
    if (index === 1) dependentReceipt = receipt;
    writeFileSync(join(assessmentRoot, path), JSON.stringify(receipt));
    git(assessmentRoot, 'add', path);
    git(assessmentRoot, 'commit', '-qm', `record ${sliceIds[index]} qualification`);
  }
  assert.equal(assess().status, 0, 'receipt-only commits must preserve tested source and prior receipts');
  writeFileSync(join(assessmentRoot, dependentReceiptPath), JSON.stringify({ ...dependentReceipt, subjectCommit: sliceReceipt.subjectCommit }));
  git(assessmentRoot, 'add', dependentReceiptPath);
  git(assessmentRoot, 'commit', '-qm', 'prerequisite absent at test time');
  assert.equal(assess().status, 1, 'dependent testing requires its prerequisite receipt to already exist');
  writeFileSync(join(assessmentRoot, dependentReceiptPath), JSON.stringify(dependentReceipt));
  git(assessmentRoot, 'add', dependentReceiptPath);
  git(assessmentRoot, 'commit', '-qm', 'restore dependent receipt');
  assert.equal(assess().status, 0);
  writeFileSync(join(assessmentRoot, 'hidden.ts'), 'export const hidden = true;');
  assert.equal(assess().status, 1, 'ignored source contamination must fail');
  rmSync(join(assessmentRoot, 'hidden.ts'));
  saveReceipt({ ...sliceReceipt, subjectHash: 'sha256:stale' });
  git(assessmentRoot, 'add', receiptPath);
  git(assessmentRoot, 'commit', '-qm', 'invalid digest');
  assert.equal(assess().status, 1, 'committed stale receipt digest must fail');
  saveReceipt(sliceReceipt);
  git(assessmentRoot, 'add', receiptPath);
  git(assessmentRoot, 'commit', '-qm', 'restore receipt');
  const unrelatedCommit = git(assessmentRoot, 'commit-tree', git(assessmentRoot, 'rev-parse', 'HEAD^{tree}'), '-m', 'unrelated same-tree subject');
  for (const invalid of [{ schemaVersion: 1 }, { passed: false }, { cleanWorktree: false },
    { commands: ['npm run other'] }, { subjectCommit: unrelatedCommit }]) {
    saveReceipt({ ...sliceReceipt, ...invalid });
    git(assessmentRoot, 'add', receiptPath);
    git(assessmentRoot, 'commit', '-qm', 'invalid receipt contract');
    const result = assess();
    assert.equal(result.status, 1, `invalid receipt must fail: ${JSON.stringify(invalid)}`);
    const dependent = JSON.parse(result.stdout).slices.find(slice => slice.id === 'S2');
    assert.equal(dependent.ready, false, 'a failed prerequisite must block its dependent');
  }
  saveReceipt(sliceReceipt);
  git(assessmentRoot, 'add', receiptPath);
  git(assessmentRoot, 'commit', '-qm', 'restore valid receipt contract');
  assert.equal(assess().status, 0, 'restored receipts must qualify unchanged source');
  saveReceipt({ ...sliceReceipt, note: 'replaced passing receipt' });
  git(assessmentRoot, 'add', receiptPath);
  git(assessmentRoot, 'commit', '-qm', 'replace prerequisite receipt');
  assert.equal(assess().status, 1, 'replacing a passing prerequisite must invalidate its consumers');
  saveReceipt(sliceReceipt);
  git(assessmentRoot, 'add', receiptPath);
  git(assessmentRoot, 'commit', '-qm', 'restore prerequisite receipt');
  assert.equal(assess().status, 0);
  writeFileSync(join(assessmentRoot, 'package.json'), JSON.stringify({ scripts: { verify: 'false' } }));
  assert.equal(assess().status, 1, 'unstaged source changes must fail');
  git(assessmentRoot, 'add', 'package.json');
  assert.equal(assess().status, 1, 'staged source changes must fail');
  git(assessmentRoot, 'commit', '-qm', 'changed source');
  assert.equal(assess().status, 1, 'changed committed source cannot reuse a previous receipt');
  writeFileSync(join(assessmentRoot, 'package.json'), JSON.stringify({ scripts: { verify: 'true' } }));
  git(assessmentRoot, 'add', 'package.json');
  git(assessmentRoot, 'commit', '-qm', 'restore tested source');
  assert.equal(assess().status, 0);
  writeFileSync(join(assessmentRoot, 'docs/specs/evidence/review.json'), '{}');
  git(assessmentRoot, 'add', 'docs/specs/evidence/review.json');
  git(assessmentRoot, 'commit', '-qm', 'changed non-receipt evidence');
  assert.equal(assess().status, 1, 'other evidence must remain part of the tested subject');
  for (const slices of [[], fixtureSlices.slice(1), [...fixtureSlices.slice(0, -1), fixtureSlices[0]],
    fixtureSlices.map((slice, index) => index === 0 ? { ...slice, acceptanceCommands: [] } : slice),
    fixtureSlices.map((slice, index) => index === 1 ? { ...slice, dependsOn: [] } : slice)]) {
    writeFileSync(join(assessmentRoot, roadmapPath), JSON.stringify({ slices }));
    git(assessmentRoot, 'add', roadmapPath);
    git(assessmentRoot, 'commit', '-qm', 'invalid roadmap');
    const result = assess();
    assert.equal(result.status, 1, 'incomplete roadmap must not qualify');
    assert.equal(JSON.parse(result.stdout).roadmapValid, false);
  }
  console.log('Slice 1B qualification negative controls passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
