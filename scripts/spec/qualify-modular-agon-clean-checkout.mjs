import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectSubjectContamination, hashGitSubject, validateDependencyGraph, validateSubjectBoundReview, isSourceBearingPath } from './slice1b-qualification-gates.mjs';

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const subjectPathspecs = ['.'];
const excludedReceiptPaths = [
  'docs/specs/evidence/modular-agon-slice1b-review-evidence.json',
  'docs/specs/evidence/modular-agon-slice1b-verification-receipt.json',
];

function run(command, args, cwd = root, encoding = 'utf8') {
  const result = spawnSync(command, args, { cwd, encoding, maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}

function materializeSubject(checkout, subject) {
  if (subject === 'index') {
    const result = run('git', ['checkout-index', '--all', `--prefix=${checkout}/`]);
    if (result.status !== 0) throw new Error(result.stderr || 'checkout-index failed');
    return;
  }
  const archive = join(checkout, 'subject.tar');
  const archived = run('git', ['archive', '--format=tar', `--output=${archive}`, 'HEAD']);
  if (archived.status !== 0) throw new Error(archived.stderr || 'git archive failed');
  const extracted = run('tar', ['-xf', archive, '-C', checkout]);
  if (extracted.status !== 0) throw new Error(extracted.stderr || 'tar extraction failed');
  rmSync(archive, { force: true });
}

function cleanSubjectSteps(subject) {
  const checkout = mkdtempSync(join(tmpdir(), `agon-modular-clean-${subject}-`));
  const steps = [];
  try {
    materializeSubject(checkout, subject);
    for (const [id, command, args] of [
      ['npm-ci', 'npm', ['ci', '--ignore-scripts']],
      ['mod-api-build', 'npm', ['run', 'build', '-w', 'packages/mod-api']],
      ['mod-kernel-build', 'npm', ['run', 'build', '-w', 'packages/mod-kernel']],
      ['slice1a-negative-controls', 'node', ['scripts/spec/verify-modular-slice1a-gates.mjs']],
      ['slice1b-negative-controls', 'node', ['scripts/spec/verify-modular-slice1b-gates.mjs']],
      ['legacy-oracle', 'node', ['scripts/spec/verify-modular-legacy-oracle.mjs']],
      ['legacy-oracle-negative-controls', 'node', ['scripts/spec/verify-modular-legacy-oracle-negative-controls.mjs']],
      ['roadmap-contract', 'node', ['scripts/spec/verify-modular-agon-roadmap.mjs']],
      ['contract-tests', 'npm', ['run', 'test:modular-slice1a']],
    ]) {
      const result = run(command, args, checkout);
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      steps.push({ id, command: [command, ...args], status: result.status, passed: result.status === 0, outputTail: output.slice(-4000) });
      if (result.status !== 0) break;
    }
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
  return steps;
}

const subjectKind = process.argv.includes('--subject=commit') ? 'commit' : 'index';
const allContamination = collectSubjectContamination(root, ['.']);
const contamination = Object.fromEntries(Object.entries(allContamination).map(([kind, paths]) => [kind, paths.filter((path) => isSourceBearingPath(path, { nonSourcePaths: excludedReceiptPaths }))]));
const packageMap = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8'));
const graph = validateDependencyGraph(packageMap.packages);
const indexHash = hashGitSubject(root, { kind: 'index', pathspecs: subjectPathspecs, excludedPaths: excludedReceiptPaths });
const commitHash = hashGitSubject(root, { kind: 'commit', revision: 'HEAD', pathspecs: subjectPathspecs, excludedPaths: excludedReceiptPaths });
const reviewEvidencePath = join(root, 'docs/specs/evidence/modular-agon-slice1b-review-evidence.json');
const reviewEvidence = existsSync(reviewEvidencePath)
  ? validateSubjectBoundReview(root, JSON.parse(readFileSync(reviewEvidencePath, 'utf8')), { kind: subjectKind, revision: 'HEAD', hash: subjectKind === 'index' ? indexHash : commitHash })
  : { passed: false, reason: 'review evidence is missing' };
const steps = process.argv.includes('--run-clean') ? cleanSubjectSteps(subjectKind) : [];
const receipt = {
  schemaVersion: 2,
  qualification: 'modular-agon-clean-checkout',
  subject: {
    kind: subjectKind,
    hash: subjectKind === 'index' ? indexHash : commitHash,
    indexHash,
    commitHash,
    indexEqualsCommit: indexHash === commitHash,
  },
  contamination,
  graph: { packages: packageMap.packages.length, ...graph },
  reviewEvidence,
  cleanCheckoutSteps: steps,
};
const noContamination = Object.values(contamination).every((paths) => paths.length === 0);
const exactCommit = subjectKind === 'index' || indexHash === commitHash;
receipt.passed = noContamination && exactCommit && reviewEvidence.passed && graph.duplicateEdges.length === 0 && graph.uniqueEdges === 144 && steps.length > 0 && steps.every(({ passed }) => passed);
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
