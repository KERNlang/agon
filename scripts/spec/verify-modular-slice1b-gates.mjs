import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';
import {
  collectSubjectContamination,
  hashGitSubject,
  hashReviewSubject,
  REVIEW_INPUT_POLICY,
  validateSliceReview,
  isSourceBearingPath,
  initializeMaterializedGitSubject,
  materializeGitSubject,
  pinGitSubject,
  verifyMaterializedGitSubject,
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
  const snapshotRoot = join(temp, 'snapshot-source');
  mkdirSync(snapshotRoot);
  git(snapshotRoot, 'init', '-q');
  git(snapshotRoot, 'config', 'user.email', 'slice1b@example.invalid');
  git(snapshotRoot, 'config', 'user.name', 'Slice 1B Fixture');
  writeFileSync(join(snapshotRoot, '.gitattributes'), 'required.ts export-ignore\nversion.txt export-subst\nnormalized.txt text eol=lf\n');
  writeFileSync(join(snapshotRoot, 'required.ts'), 'original source');
  writeFileSync(join(snapshotRoot, 'version.txt'), '$Format:%H$\n');
  writeFileSync(join(snapshotRoot, 'binary'), Buffer.from([0, 10, 255, 13]));
  writeFileSync(join(snapshotRoot, 'normalized.txt'), 'first\r\nsecond\r\n');
  chmodSync(join(snapshotRoot, 'binary'), 0o755);
  git(snapshotRoot, 'add', '.gitattributes', 'required.ts', 'version.txt', 'binary');
  const rawBlob = spawnSync('git', ['hash-object', '-w', '--stdin', '--no-filters'], { cwd: snapshotRoot, input: 'first\r\nsecond\r\n', encoding: 'utf8' });
  assert.equal(rawBlob.status, 0, rawBlob.stderr);
  git(snapshotRoot, 'update-index', '--add', '--cacheinfo', `100644,${rawBlob.stdout.trim()},normalized.txt`);
  git(snapshotRoot, 'commit', '-qm', 'snapshot source');
  const pinnedCommit = pinGitSubject(snapshotRoot, 'commit');
  writeFileSync(join(snapshotRoot, 'required.ts'), 'staged source');
  git(snapshotRoot, 'add', 'required.ts');
  const pinnedIndex = pinGitSubject(snapshotRoot, 'index');
  const pinnedHash = hashGitSubject(snapshotRoot, { ...pinnedIndex, pathspecs: ['.'] });
  git(snapshotRoot, 'commit', '-qm', 'move HEAD');
  writeFileSync(join(snapshotRoot, 'required.ts'), 'new index source');
  git(snapshotRoot, 'add', 'required.ts');
  assert.equal(hashGitSubject(snapshotRoot, { ...pinnedIndex, pathspecs: ['.'] }), pinnedHash);
  for (const [subject, expected] of [[pinnedCommit, 'original source'], [pinnedIndex, 'staged source']]) {
    const destination = mkdtempSync(join(temp, 'materialized-'));
    assert.equal(materializeGitSubject(snapshotRoot, destination, subject).files, 5);
    assert.equal(readFileSync(join(destination, 'required.ts'), 'utf8'), expected);
    assert.equal(readFileSync(join(destination, 'version.txt'), 'utf8'), '$Format:%H$\n');
    assert.deepEqual(readFileSync(join(destination, 'binary')), Buffer.from([0, 10, 255, 13]));
    writeFileSync(join(destination, 'required.ts'), 'changed source');
    assert.throws(() => verifyMaterializedGitSubject(snapshotRoot, destination, subject), /bytes or mode differ/);
    writeFileSync(join(destination, 'required.ts'), expected);
    chmodSync(join(destination, 'binary'), 0o644);
    assert.throws(() => verifyMaterializedGitSubject(snapshotRoot, destination, subject), /bytes or mode differ/);
    chmodSync(join(destination, 'binary'), 0o755);
    writeFileSync(join(destination, 'extra.ts'), 'unqualified');
    assert.throws(() => verifyMaterializedGitSubject(snapshotRoot, destination, subject), /unexpected qualification entry/);
    rmSync(join(destination, 'extra.ts'));
    mkdirSync(join(destination, 'extra-directory'));
    assert.throws(() => verifyMaterializedGitSubject(snapshotRoot, destination, subject), /unexpected qualification entry/);
    rmSync(join(destination, 'extra-directory'), { recursive: true });
    rmSync(join(destination, 'required.ts'));
    assert.throws(() => verifyMaterializedGitSubject(snapshotRoot, destination, subject), /ENOENT/);
  }
  const invalidGitDestination = mkdtempSync(join(temp, 'invalid-git-destination-'));
  writeFileSync(join(invalidGitDestination, '.git'), 'gitdir: /not-a-qualification-repository\n');
  assert.throws(() => materializeGitSubject(snapshotRoot, invalidGitDestination, pinnedCommit), /qualification Git directory/);
  for (const name of ['clean-checkout', 'slice2', 'slice3', 'slice4', 'slice5', 'slice6', 'slice7', 'slice8', 'slice9']) {
    const url = new URL(`qualify-modular-agon-${name}.mjs`, import.meta.url);
    const source = readFileSync(url, 'utf8').split('const subjectKind =')[0]
      .replace(/^import [\s\S]*?;\n/gm, '').replaceAll('import.meta.url', JSON.stringify(url.href));
    for (const kind of ['commit', 'index']) {
      const destination = mkdtempSync(join(temp, `qualifier-${name}-${kind}-`));
      const subject = pinGitSubject(snapshotRoot, kind);
      const call = ['slice8', 'slice9'].includes(name) ? 'materialize' : 'materializeSubject';
      runInNewContext(source + `\ntry { ${call}(destination, kind); } finally { if (typeof runtimeRoot !== 'undefined') rmSync(runtimeRoot, { recursive: true, force: true }); }`, {
        URL, fileURLToPath: () => snapshotRoot, destination, kind,
        mkdtempSync, readFileSync, rmSync, tmpdir, join, spawnSync, process,
        pinGitSubject, materializeGitSubject, initializeMaterializedGitSubject,
      });
      assert.equal(verifyMaterializedGitSubject(snapshotRoot, destination, subject).files, 5, `${name}/${kind} must use exact Git blobs`);
      if (['slice4', 'slice5', 'slice6', 'slice7', 'slice8', 'slice9'].includes(name)) {
        assert.equal(git(destination, 'rev-parse', 'HEAD^{tree}'), subject.tree, `${name}/${kind} history must preserve the raw tree`);
      }
      if (['slice4', 'slice5', 'slice6', 'slice7'].includes(name)) {
        const expectedParent = kind === 'index' ? 'staged source' : 'original source';
        assert.equal(git(destination, 'show', 'HEAD^:required.ts'), expectedParent, `${name}/${kind} must retain rollback parent`);
        assert.equal(git(destination, 'rev-parse', 'HEAD^:normalized.txt'), rawBlob.stdout.trim(), 'rollback must not normalize the parent blob');
      }
    }
  }
  for (const [mode, object] of [['120000', git(snapshotRoot, 'rev-parse', 'HEAD:required.ts')], ['160000', git(snapshotRoot, 'rev-parse', 'HEAD')]]) {
    git(snapshotRoot, 'update-index', '--add', '--cacheinfo', `${mode},${object},unsupported`);
    const unsupported = pinGitSubject(snapshotRoot, 'index');
    const destination = mkdtempSync(join(temp, 'unsupported-mode-'));
    assert.throws(() => materializeGitSubject(snapshotRoot, destination, unsupported), /unsupported qualification entry/);
    git(snapshotRoot, 'update-index', '--force-remove', 'unsupported');
  }
  for (const validUtf8 of [false, true]) {
    const name = validUtf8 ? Buffer.from('bad-�.txt') : Buffer.concat([Buffer.from('bad-'), Buffer.from([255]), Buffer.from('.txt')]);
    const tree = spawnSync('git', ['mktree', '-z'], { cwd: snapshotRoot, encoding: 'utf8',
      input: Buffer.concat([Buffer.from(`100644 blob ${rawBlob.stdout.trim()}\t`), name, Buffer.from([0])]) });
    assert.equal(tree.status, 0, tree.stderr);
    const subject = { ...pinnedCommit, tree: tree.stdout.trim() };
    const destination = mkdtempSync(join(temp, 'filename-encoding-'));
    if (validUtf8) {
      assert.equal(materializeGitSubject(snapshotRoot, destination, subject).files, 1);
      assert.deepEqual(readdirSync(destination), ['bad-�.txt']);
    } else {
      assert.throws(() => materializeGitSubject(snapshotRoot, destination, subject), /valid UTF-8/);
      assert.deepEqual(readdirSync(destination), [], 'invalid filenames must fail before writing');
    }
  }
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
  const reviewPath = id => `docs/specs/evidence/modular-agon-slice${id.slice(1).toLowerCase()}-review-evidence.json`;
  const reviewArtifacts = ['review-a.txt', 'review-b.txt'].map(name => `docs/specs/evidence/${name}`);
  for (const path of reviewArtifacts) writeFileSync(join(assessmentRoot, path), `independent fixture review ${path}\n`);
  git(assessmentRoot, 'add', '.');
  git(assessmentRoot, 'commit', '-qm', 'qualified source');
  const reviewHashes = sliceIds.map(id => hashReviewSubject(assessmentRoot, { kind: 'commit' }, id));
  assert.equal(new Set(reviewHashes).size, 9, 'slice IDs must separate review hash domains');
  const rawReviewHash = hashGitSubject(assessmentRoot, { kind: 'commit', pathspecs: ['.'] });
  for (const [index, id] of sliceIds.entries()) {
    const expected = `sha256:${createHash('sha256').update(`modular-review-input-v2\0${id}\0${rawReviewHash}`).digest('hex')}`;
    assert.equal(reviewHashes[index], expected, 'policy and slice domain separation must match the contract');
  }
  const fixtureReviews = sliceIds.map((id, index) => ({
    schemaVersion: 1, subject: { kind: 'commit', policy: REVIEW_INPUT_POLICY, hash: reviewHashes[index] },
    disposition: 'passed', findings: [],
    runs: reviewArtifacts.map((path, engine) => ({ engine: `fixture-${engine}`, status: 'completed',
      artifacts: [{ path, hash: hashGitSubject(assessmentRoot, { kind: 'commit', pathspecs: [path], includePathsInHash: false }) }] })),
  }));
  for (const [index, id] of sliceIds.entries()) writeFileSync(join(assessmentRoot, reviewPath(id)), JSON.stringify(fixtureReviews[index]));
  git(assessmentRoot, 'add', ...sliceIds.map(reviewPath));
  git(assessmentRoot, 'commit', '-qm', 'seal fixture reviews');
  for (const [index, id] of sliceIds.entries()) {
    assert.equal(hashReviewSubject(assessmentRoot, { kind: 'commit' }, id), reviewHashes[index], 'sealing all reviews must not change review inputs');
    assert.equal(validateSliceReview(assessmentRoot, id, { kind: 'commit' }).passed, true);
  }
  assert.throws(() => hashReviewSubject(assessmentRoot, { kind: 'commit' }, 'S10'), /unknown review slice/);
  const firstReview = fixtureReviews[0];
  const expectedReviewSubject = { kind: 'commit', hash: reviewHashes[0], policy: REVIEW_INPUT_POLICY };
  for (const policy of [undefined, 'legacy', `${REVIEW_INPUT_POLICY}-unknown`]) {
    assert.equal(validateSubjectBoundReview(assessmentRoot, { ...firstReview, subject: { ...firstReview.subject, policy } }, expectedReviewSubject).passed, false, 'review policy must match');
  }
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
  const aggregateHash = () => hashGitSubject(assessmentRoot, { kind: 'commit', pathspecs: ['.'],
    excludedPaths: sliceIds.map(id => `docs/specs/evidence/receipts/modular-agon-${id.toLowerCase()}.json`) });
  const originalReceipts = sliceIds.map(id => {
    const path = `docs/specs/evidence/receipts/modular-agon-${id.toLowerCase()}.json`;
    return { path, bytes: readFileSync(join(assessmentRoot, path)) };
  });
  for (const [index, id] of sliceIds.entries()) {
    const originalReview = fixtureReviews[index];
    const defects = [
      { subject: { ...originalReview.subject, policy: undefined } },
      { subject: { ...originalReview.subject, policy: 'legacy' } },
      { findings: [{ status: 'open' }] },
      { runs: originalReview.runs.map(run => ({ ...run, engine: 'duplicate' })) },
      { runs: originalReview.runs.map(run => ({ ...run, artifacts: run.artifacts.map(artifact => ({ ...artifact, hash: 'sha256:bad' })) })) },
    ];
    writeFileSync(join(assessmentRoot, reviewPath(id)), JSON.stringify({ ...originalReview, ...defects[index % defects.length] }));
    git(assessmentRoot, 'add', reviewPath(id));
    git(assessmentRoot, 'commit', '-qm', 'invalid review with fresh fixture receipts');
    const sourceHash = aggregateHash();
    for (const [receiptIndex, receiptId] of sliceIds.entries()) {
      const prerequisites = receiptIndex ? { [sliceIds[receiptIndex - 1]]: git(assessmentRoot, 'rev-parse', `HEAD:${originalReceipts[receiptIndex - 1].path}`) } : {};
      const fresh = { ...sliceReceipt, subjectCommit: git(assessmentRoot, 'rev-parse', 'HEAD'), subjectHash: sourceHash, prerequisites };
      writeFileSync(join(assessmentRoot, originalReceipts[receiptIndex].path), JSON.stringify(fresh));
      git(assessmentRoot, 'add', originalReceipts[receiptIndex].path);
      git(assessmentRoot, 'commit', '-qm', `fresh fixture ${receiptId}`);
    }
    const result = assess();
    const cells = JSON.parse(result.stdout).slices;
    assert.equal(cells.every(cell => cell.receipt.valid), true, 'fresh fixture receipts must pass independently of review validation');
    assert.equal(cells[index].review.passed, false);
    assert.equal(cells[index].ready, false, 'assessor must enforce each slice review');
    assert.equal(result.status, 1);
    writeFileSync(join(assessmentRoot, reviewPath(id)), JSON.stringify(originalReview));
    for (const { path, bytes } of originalReceipts) writeFileSync(join(assessmentRoot, path), bytes);
    git(assessmentRoot, 'add', reviewPath(id), ...originalReceipts.map(({ path }) => path));
    git(assessmentRoot, 'commit', '-qm', 'restore fixture evidence');
    assert.equal(assess().status, 0);
  }
  const projectionCases = [
    ...sliceIds.map(id => ({ path: reviewPath(id), excluded: sliceIds, aggregateExcluded: false })),
    ...originalReceipts.map(({ path }) => ({ path, excluded: sliceIds, aggregateExcluded: true })),
    ...sliceIds.map(id => ({ path: `docs/specs/evidence/modular-agon-slice${id.slice(1).toLowerCase()}-verification-receipt.json`, excluded: [id], aggregateExcluded: false })),
    ...['S1B', 'S3', 'S4', 'S9'].map(id => ({ path: `docs/specs/evidence/verification-logs/slice${id.slice(1).toLowerCase()}/probe.txt`, excluded: ['S4', 'S9'].includes(id) ? [id] : [], aggregateExcluded: false })),
    ...['docs/specs/evidence/verification-logs/slice4-extra/probe.txt', `${reviewPath('S1B')}.bak`, 'tests/fixtures/review-probe.json'].map(path => ({ path, excluded: [], aggregateExcluded: false })),
  ];
  for (const { path, excluded, aggregateExcluded } of projectionCases) {
    let original;
    try { original = readFileSync(join(assessmentRoot, path)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    mkdirSync(join(assessmentRoot, path, '..'), { recursive: true });
    const before = aggregateHash();
    const isManifest = sliceIds.some(id => reviewPath(id) === path);
    writeFileSync(join(assessmentRoot, path), isManifest
      ? JSON.stringify({ ...JSON.parse(original), note: 'harmless metadata' }) : 'changed projection fixture');
    git(assessmentRoot, 'add', path);
    git(assessmentRoot, 'commit', '-qm', 'projection boundary fixture');
    assert.equal(aggregateHash() === before, aggregateExcluded, `aggregate binding: ${path}`);
    for (const [index, id] of sliceIds.entries()) assert.equal(hashReviewSubject(assessmentRoot, { kind: 'commit' }, id) === reviewHashes[index], excluded.includes(id), `review boundary: ${id}: ${path}`);
    if (isManifest) {
      for (const id of sliceIds) assert.equal(validateSliceReview(assessmentRoot, id, { kind: 'commit' }).passed, true, 'harmless manifest metadata preserves review validity');
      assert.equal(JSON.parse(assess().stdout).slices[0].receipt.valid, false, 'aggregate must bind even valid edited reviews');
    }
    if (original) writeFileSync(join(assessmentRoot, path), original);
    else rmSync(join(assessmentRoot, path));
    git(assessmentRoot, 'add', path);
    git(assessmentRoot, 'commit', '-qm', 'restore projection boundary fixture');
  }
  for (const [index, id] of sliceIds.entries()) {
    assert.equal(hashReviewSubject(assessmentRoot, { kind: 'commit' }, id), reviewHashes[index], 'receipt progression must preserve review input');
    assert.equal(validateSliceReview(assessmentRoot, id, { kind: 'commit' }).passed, true);
  }
  for (const [path, altered] of [
    [reviewPath('S1B'), JSON.stringify({ ...firstReview, findings: [{ status: 'open' }] })],
    [reviewArtifacts[0], 'tampered artifact'],
  ]) {
    const original = readFileSync(join(assessmentRoot, path));
    writeFileSync(join(assessmentRoot, path), altered);
    git(assessmentRoot, 'add', path);
    git(assessmentRoot, 'commit', '-qm', 'tamper review evidence');
    assert.equal(assess().status, 1, 'aggregate receipts must bind every review envelope and artifact');
    assert.equal(validateSliceReview(assessmentRoot, 'S1B', { kind: 'commit' }).passed, false, 'current review validation must reject tampering');
    writeFileSync(join(assessmentRoot, path), original);
    git(assessmentRoot, 'add', path);
    git(assessmentRoot, 'commit', '-qm', 'restore review evidence');
    assert.equal(assess().status, 0);
  }
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
  for (const [index, id] of sliceIds.entries()) assert.notEqual(hashReviewSubject(assessmentRoot, { kind: 'commit' }, id), reviewHashes[index], 'source changes must invalidate every review');
  writeFileSync(join(assessmentRoot, 'package.json'), JSON.stringify({ scripts: { verify: 'true' } }));
  git(assessmentRoot, 'add', 'package.json');
  git(assessmentRoot, 'commit', '-qm', 'restore tested source');
  assert.equal(assess().status, 0);
  writeFileSync(join(assessmentRoot, 'docs/specs/evidence/review.json'), '{}');
  git(assessmentRoot, 'add', 'docs/specs/evidence/review.json');
  git(assessmentRoot, 'commit', '-qm', 'changed non-receipt evidence');
  assert.equal(assess().status, 1, 'other evidence must remain part of the tested subject');
  for (const [index, id] of sliceIds.entries()) assert.notEqual(hashReviewSubject(assessmentRoot, { kind: 'commit' }, id), reviewHashes[index], 'unknown evidence must remain review input');
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
