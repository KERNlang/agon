import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { materializeGitSubject, pinGitSubject } from './slice1b-qualification-gates.mjs';
import { collectSubjectContamination, hashReviewSubject, validateDependencyGraph, validateSliceReview, isSourceBearingPath } from './slice1b-qualification-gates.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const commitSubject = pinGitSubject(root, 'commit');
const indexSubject = pinGitSubject(root, 'index', commitSubject.revision);
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
  materializeGitSubject(root, checkout, subject === 'index' ? indexSubject : commitSubject);
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
      ['modular-runtime-build', 'npm', ['run', 'build:cli:workspaces']],
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
const indexHash = hashReviewSubject(root, indexSubject, 'S1B');
const commitHash = hashReviewSubject(root, commitSubject, 'S1B');
const reviewEvidence = validateSliceReview(root, 'S1B', subjectKind === 'index' ? indexSubject : commitSubject);
const steps = process.argv.includes('--run-clean') ? cleanSubjectSteps(subjectKind) : [];
const receipt = {
  schemaVersion: 2,
  qualification: 'modular-agon-clean-checkout',
  subject: {
    ...(subjectKind === 'index' ? indexSubject : commitSubject),
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
receipt.passed = noContamination && exactCommit && reviewEvidence.passed && graph.duplicateEdges.length === 0 && graph.uniqueEdges === 155 && steps.length > 0 && steps.every(({ passed }) => passed);
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
