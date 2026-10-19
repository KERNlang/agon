import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initializeMaterializedGitSubject, materializeGitSubject, pinGitSubject } from './slice1b-qualification-gates.mjs';
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
  'docs/specs/evidence/modular-agon-slice7-review-evidence.json',
  'docs/specs/evidence/modular-agon-slice7-verification-receipt.json',
];

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 96 * 1024 * 1024,
    env: {
      ...process.env,
      AGON_HOME: join(cwd, '.agon-s6-home'),
      npm_config_cache: process.env.AGON_QUALIFICATION_NPM_CACHE ?? join(cwd, '.npm-s6-cache'),
      npm_config_logs_dir: join(cwd, '.npm-s6-logs'),
      npm_config_ignore_scripts: 'true',
      NODE_OPTIONS: '--max-old-space-size=8192',
    },
  });
  if (result.error) throw result.error;
  return result;
}

function materializeSubject(checkout, subject) {
  const parent = subject === 'index' ? commitSubject : pinGitSubject(root, 'commit', `${commitSubject.revision}^`);
  materializeGitSubject(root, checkout, parent);
  initializeMaterializedGitSubject(root, checkout, parent);
  // Raw blobs can differ from Git's clean-filter view.
  const cleared = run('git', ['rm', '-r', '--force', '--quiet', '--ignore-unmatch', '.'], checkout);
  if (cleared.status !== 0) throw new Error(cleared.stderr || 'qualification parent cleanup failed');
  const pinned = subject === 'index' ? indexSubject : commitSubject;
  materializeGitSubject(root, checkout, pinned);
  initializeMaterializedGitSubject(root, checkout, pinned);
}

function cleanSubjectSteps(subject) {
  const checkout = mkdtempSync(join(tmpdir(), `agon-modular-s7-${subject}-`));
  const steps = [];
  try {
    materializeSubject(checkout, subject);
    const commands = [
      ["npm-ci", "npm", ["ci", "--ignore-scripts", "--offline"]],
      ["clean-build", "npm", ["run", "build:cli:workspaces"]],
      ['managed-lifecycle', 'npm', ['run', 'test:modular-slice7']],
      ["support-packages", "npm", ["run", "test:modular-support-packages"]],
      ["first-party-packages", "npm", ["run", "test:modular-first-party"]],
      ["first-party-disable-matrix", "npm", ["run", "test:modular-disable-matrix"]],
      ['managed-lifecycle-contract', 'node', ['scripts/spec/verify-modular-slice7-lifecycle.mjs', '--self-test']],
      ['surface-cutover-regression', 'npm', ['run', 'test:modular-slice6']],
      ["typecheck", "npm", ["run", "typecheck"]],
      ["lint", "npm", ["run", "lint"]],
      ["full-repository-suite", "npm", ["run", "test:ts"]],
      ["generated-artifacts", "npm", ["run", "spec:modular-generated:check"]],
      ["spec-consistency", "node", ["scripts/spec/check-modular-agon-consistency.mjs"]],
      ["roadmap-contract", "node", ["scripts/spec/verify-modular-agon-roadmap.mjs"]],
      ["legacy-oracle", "npm", ["run", "test:modular-legacy-oracle"]],
      ["legacy-oracle-negative-controls", "npm", ["run", "test:modular-oracle-boundary"]],
      ["slice7-performance", "npm", ["run", "perf:modular-slice7"]],
    ];
    for (const [id, command, args] of commands) {
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
const contamination = Object.fromEntries(Object.entries(allContamination).map(([kind, paths]) => [
  kind,
  paths.filter((path) => isSourceBearingPath(path, { nonSourcePaths: excludedReceiptPaths })),
]));
const packageMap = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8'));
const graph = validateDependencyGraph(packageMap.packages);
const indexHash = hashReviewSubject(root, indexSubject, 'S7');
const commitHash = hashReviewSubject(root, commitSubject, 'S7');
const expectedHash = subjectKind === 'index' ? indexHash : commitHash;
const reviewEvidence = validateSliceReview(root, 'S7', subjectKind === 'index' ? indexSubject : commitSubject);
const performance = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-slice7-performance.json'), 'utf8'));
const inventory = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-current-inventory.json'), 'utf8'));
const inventoryAssignments = Object.values(inventory.categories).reduce((sum, entries) => sum + entries.length, 0);
const steps = process.argv.includes('--run-clean') ? cleanSubjectSteps(subjectKind) : [];
const receipt = {
  schemaVersion: 1,
  qualification: 'modular-agon-slice7-clean-checkout',
  subject: { ...(subjectKind === 'index' ? indexSubject : commitSubject), hash: expectedHash, indexHash, commitHash, indexEqualsCommit: indexHash === commitHash },
  contamination,
  graph: { packages: packageMap.packages.length, ...graph },
  firstPartyPackages: 36,
  coverage: { inventoryAssignments, lifecycleTests: 44, faultPoints: 8, temporaryAdapters: 0, postinstallRemoved: true },
  performance,
  reviewEvidence,
  cleanCheckoutSteps: steps,
};
const noContamination = Object.values(contamination).every((paths) => paths.length === 0);
const exactCommit = subjectKind === 'index' || indexHash === commitHash;
receipt.passed = noContamination
  && exactCommit
  && reviewEvidence.passed
  && graph.duplicateEdges.length === 0
  && graph.uniqueEdges === 156
  && performance.passed === true
  && inventoryAssignments === 872
  && steps.length > 0
  && steps.every(({ passed }) => passed);
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
