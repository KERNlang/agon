import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
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
const indexHash = hashGitSubject(root, { kind: 'index', pathspecs: ['.'], excludedPaths: excludedReceiptPaths });
const commitHash = hashGitSubject(root, { kind: 'commit', revision: 'HEAD', pathspecs: ['.'], excludedPaths: excludedReceiptPaths });
const expectedHash = subjectKind === 'index' ? indexHash : commitHash;
const reviewPath = join(root, 'docs/specs/evidence/modular-agon-slice3-review-evidence.json');
const reviewEvidence = existsSync(reviewPath)
  ? validateSubjectBoundReview(root, JSON.parse(readFileSync(reviewPath, 'utf8')), {
    kind: subjectKind,
    revision: 'HEAD',
    hash: expectedHash,
  })
  : { passed: false, reason: 'S3 review evidence is missing' };
const performance = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-slice3-performance.json'), 'utf8'));
const steps = process.argv.includes('--run-clean') ? cleanSubjectSteps(subjectKind) : [];
const receipt = {
  schemaVersion: 1,
  qualification: 'modular-agon-slice3-clean-checkout',
  subject: {
    kind: subjectKind,
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
  && graph.uniqueEdges === 144
  && performance.budgets.planGreen === true
  && performance.budgets.groupedViewGreen === true
  && steps.length > 0
  && steps.every(({ passed }) => passed);
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
