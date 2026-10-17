import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { materializeGitSubject, pinGitSubject } from './slice1b-qualification-gates.mjs';
import {
  collectSubjectContamination,
  hashReviewSubject,
  isSourceBearingPath,
  validateDependencyGraph,
  validateSliceReview,
} from './slice1b-qualification-gates.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const commitSubject = pinGitSubject(root, 'commit');
const indexSubject = pinGitSubject(root, 'index', commitSubject.revision);
const excludedReceiptPaths = [
  'docs/specs/evidence/modular-agon-slice3-review-evidence.json',
  'docs/specs/evidence/modular-agon-slice3-verification-receipt.json',
];

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error) throw result.error;
  return result;
}

function materializeSubject(checkout, subject) {
  materializeGitSubject(root, checkout, subject === 'index' ? indexSubject : commitSubject);
}

function cleanSubjectSteps(subject) {
  const checkout = mkdtempSync(join(tmpdir(), `agon-modular-s3-${subject}-`));
  const steps = [];
  try {
    materializeSubject(checkout, subject);
    for (const [id, command, args] of [
      ['npm-ci', 'npm', ['ci', '--ignore-scripts']],
      ['mod-api-build', 'npm', ['run', 'build', '-w', 'packages/mod-api']],
      ['mod-kernel-build', 'npm', ['run', 'build', '-w', 'packages/mod-kernel']],
      ['slice1b-negative-controls', 'npm', ['run', 'spec:modular-slice1b:self-test']],
      ['slice2-host', 'npm', ['run', 'test:modular-host']],
      ['slice2-crash-recovery', 'npm', ['run', 'test:modular-crash-recovery']],
      ['slice2-migrations', 'npm', ['run', 'test:modular-migration-engine']],
      ['slice2-observability', 'npm', ['run', 'test:modular-observability']],
      ['slice3-state', 'npm', ['run', 'test:modular-state']],
      ['slice3-ui', 'npm', ['run', 'test:modular-ui']],
      ['slice3-accessibility', 'npm', ['run', 'test:modular-ui-accessibility']],
      ['slice3-negative-controls', 'npm', ['run', 'spec:modular-slice3:self-test']],
      ['generated-artifacts', 'npm', ['run', 'spec:modular-generated:check']],
      ['spec-consistency', 'node', ['scripts/spec/check-modular-agon-consistency.mjs']],
      ['legacy-oracle', 'npm', ['run', 'test:modular-legacy-oracle']],
      ['legacy-oracle-negative-controls', 'npm', ['run', 'test:modular-oracle-boundary']],
      ['roadmap-contract', 'node', ['scripts/spec/verify-modular-agon-roadmap.mjs']],
      ['pack-contract', 'npm', ['run', 'spec:modular-pack']],
      ['slice2-performance', 'node', ['--expose-gc', 'scripts/spec/measure-modular-slice2.mjs', '--check']],
      ['slice3-performance', 'node', ['--expose-gc', 'scripts/spec/measure-modular-slice3.mjs', '--check']],
    ]) {
      const result = run(command, args, checkout);
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      steps.push({
        id,
        command: [command, ...args],
        status: result.status,
        passed: result.status === 0,
        outputTail: output.slice(-4000),
      });
      if (result.status !== 0) break;
    }
  } finally {
    rmSync(checkout, { recursive: true, force: true });
  }
  return steps;
}

const subjectKind = process.argv.includes('--subject=commit') ? 'commit' : 'index';
const allContamination = collectSubjectContamination(root, ['.']);
const contamination = Object.fromEntries(Object.entries(allContamination).map(([kind, paths]) => [
  kind,
  paths.filter((path) => isSourceBearingPath(path, { nonSourcePaths: excludedReceiptPaths })),
]));
const packageMap = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8'));
const graph = validateDependencyGraph(packageMap.packages);
const indexHash = hashReviewSubject(root, indexSubject, 'S3');
const commitHash = hashReviewSubject(root, commitSubject, 'S3');
const expectedHash = subjectKind === 'index' ? indexHash : commitHash;
const reviewEvidence = validateSliceReview(root, 'S3', subjectKind === 'index' ? indexSubject : commitSubject);
const performance = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-slice3-performance.json'), 'utf8'));
const steps = process.argv.includes('--run-clean') ? cleanSubjectSteps(subjectKind) : [];
const receipt = {
  schemaVersion: 1,
  qualification: 'modular-agon-slice3-clean-checkout',
  subject: {
    ...(subjectKind === 'index' ? indexSubject : commitSubject),
    hash: expectedHash,
    indexHash,
    commitHash,
    indexEqualsCommit: indexHash === commitHash,
  },
  contamination,
  graph: { packages: packageMap.packages.length, ...graph },
  performance: {
    platform: performance.platform,
    planP95Ms: performance.plan.p95Ms,
    groupedViewP95Ms: performance.groupedView.p95Ms,
    budgets: performance.budgets,
  },
  reviewEvidence,
  cleanCheckoutSteps: steps,
};
const noContamination = Object.values(contamination).every((paths) => paths.length === 0);
const exactCommit = subjectKind === 'index' || indexHash === commitHash;
receipt.passed = noContamination
  && exactCommit
  && reviewEvidence.passed
  && graph.duplicateEdges.length === 0
  && graph.uniqueEdges === 155
  && performance.budgets.planGreen === true
  && performance.budgets.groupedViewGreen === true
  && steps.length > 0
  && steps.every(({ passed }) => passed);
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
