import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectSubjectContamination, hashGitSubject, isSourceBearingPath, validateDependencyGraph, validateStoredSubjectBoundReview } from './slice1b-qualification-gates.mjs';

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const excluded = ['docs/specs/evidence/modular-agon-slice9-review-evidence.json', 'docs/specs/evidence/modular-agon-slice9-verification-receipt.json'];
const excludedPrefixes = ['docs/specs/evidence/verification-logs/slice9/'];
const runtimeRoot = mkdtempSync(join(tmpdir(), 'agon-modular-s9-runtime-'));

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, env: {
    ...process.env, AGON_HOME: join(runtimeRoot, 'agon-home'), npm_config_cache: process.env.AGON_QUALIFICATION_NPM_CACHE ?? join(runtimeRoot, 'npm-cache'),
    npm_config_logs_dir: join(runtimeRoot, 'npm-logs'), npm_config_ignore_scripts: 'true', NODE_OPTIONS: '--max-old-space-size=8192',
  } });
  if (result.error) throw result.error;
  return result;
}

function materialize(checkout, subject) {
  if (subject === 'index') {
    const result = run('git', ['checkout-index', '--all', `--prefix=${checkout}/`]);
    if (result.status !== 0) throw new Error(result.stderr || 'checkout-index failed');
  } else {
    const archive = join(checkout, 'subject.tar');
    const archived = run('git', ['archive', '--format=tar', `--output=${archive}`, 'HEAD']);
    if (archived.status !== 0) throw new Error(archived.stderr || 'git archive failed');
    const extracted = run('tar', ['-xf', archive, '-C', checkout]);
    if (extracted.status !== 0) throw new Error(extracted.stderr || 'tar extraction failed');
    rmSync(archive, { force: true });
  }
  for (const args of [['init', '--quiet'], ['add', '--all', '--force'], ['-c', 'user.name=Agon Qualification', '-c', 'user.email=qualification', 'commit', '--quiet', '-m', 'qualification subject']]) {
    const result = run('git', args, checkout);
    if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
  }
}

function cleanSteps(subject) {
  const checkout = mkdtempSync(join(tmpdir(), `agon-modular-s9-${subject}-`));
  const steps = [];
  const commands = [
    ['npm-ci', 'npm', ['ci', '--ignore-scripts', '--offline']],
    ['clean-build', 'npm', ['run', 'build:cli:workspaces']],
    ['s9-negative-controls', 'node', ['scripts/spec/qualify-modular-agon-slice9.mjs', '--self-test']],
    ['generated-negative-controls', 'npm', ['run', 'spec:modular-generated:self-test']],
    ['generated-artifacts', 'npm', ['run', 'spec:modular-generated:check']],
    ['first-party-generation', 'npm', ['run', 'spec:modular-first-party:check']],
    ['release-set', 'npm', ['run', 'test:modular-release']],
    ['supply-chain', 'npm', ['run', 'test:modular-supply-chain']],
    ['npx-install', 'npm', ['run', 'test:modular-npx', '--', '--no-write']],
    ['platform-matrix', 'npm', ['run', 'test:modular-platform-matrix', '--', '--no-write']],
    ['state-migrations', 'npm', ['run', 'test:modular-state-migrations', '--', '--no-write']],
    ['physical-cutover', 'npm', ['run', 'test:modular-physical-cutover', '--', '--no-write']],
    ['manifest-capabilities', 'npm', ['run', 'test:modular-manifest-capabilities']],
    ['legacy-kill-list', 'node', ['scripts/spec/verify-modular-kill-list.mjs']],
    ['slice8-regression', 'npm', ['run', 'test:modular-slice8']],
    ['representative-workflows', 'npm', ['run', 'test:representative-workflows']],
    ['typecheck', 'npm', ['run', 'typecheck']],
    ['lint', 'npm', ['run', 'lint']],
    ['full-repository-suite', 'npm', ['run', 'test:ts']],
    ['spec-consistency', 'node', ['scripts/spec/check-modular-agon-consistency.mjs']],
    ['roadmap-contract', 'node', ['scripts/spec/verify-modular-agon-roadmap.mjs']],
    ...['1a', '2', '3', '4', '5', '6', '7', '8'].map((slice) => [`performance-s${slice}`, 'npm', ['run', `perf:modular-slice${slice}`, '--', '--no-write']]),
  ];
  try {
    materialize(checkout, subject);
    for (const [id, command, args] of commands) {
      const result = run(command, args, checkout);
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      steps.push({ id, command: [command, ...args], status: result.status, passed: result.status === 0, outputTail: output.slice(-4000) });
      if (result.status !== 0) break;
    }
    if (steps.every(({ passed }) => passed)) {
      const ignored = collectSubjectContamination(checkout, ['.']).ignored.filter((path) => isSourceBearingPath(path));
      steps.push({ id: 'final-ignored-source-contamination', command: ['git', 'ls-files', '--others', '--ignored', '--exclude-standard'], status: ignored.length ? 1 : 0, passed: ignored.length === 0, outputTail: JSON.stringify(ignored) });
    }
    if (steps.every(({ passed }) => passed)) {
      const result = run('git', ['status', '--porcelain', '--untracked-files=all'], checkout);
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      steps.push({ id: 'final-clean-worktree', command: ['git', 'status', '--porcelain', '--untracked-files=all'], status: result.status, passed: result.status === 0 && output.trim() === '', outputTail: output.slice(-4000) });
    }
  } finally { rmSync(checkout, { recursive: true, force: true }); }
  return steps;
}

const subjectKind = process.argv.includes('--subject=commit') ? 'commit' : 'index';
const contaminationRaw = collectSubjectContamination(root, ['.']);
const contamination = Object.fromEntries(Object.entries(contaminationRaw).map(([kind, paths]) => [kind, paths.filter((path) => isSourceBearingPath(path, { nonSourcePaths: excluded }))]));
const indexHash = hashGitSubject(root, { kind: 'index', pathspecs: ['.'], excludedPaths: excluded, excludedPathPrefixes: excludedPrefixes });
const commitHash = hashGitSubject(root, { kind: 'commit', revision: 'HEAD', pathspecs: ['.'], excludedPaths: excluded, excludedPathPrefixes: excludedPrefixes });
const expectedHash = subjectKind === 'index' ? indexHash : commitHash;
const reviewPath = 'docs/specs/evidence/modular-agon-slice9-review-evidence.json';
const reviewEvidence = validateStoredSubjectBoundReview(root, reviewPath, { kind: subjectKind, revision: 'HEAD', hash: expectedHash });
const packageMap = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8'));
const ownership = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-ownership.json'), 'utf8'));
const release = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-release-set.json'), 'utf8'));
const platform = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-platform-matrix.json'), 'utf8'));
const physical = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-physical-cutover.json'), 'utf8'));
const performances = ['1a', '2', '3', '4', '5', '6', '7', '8'].map((slice) => JSON.parse(readFileSync(join(root, `docs/specs/evidence/modular-agon-slice${slice}-performance.json`), 'utf8')));
const graph = validateDependencyGraph(packageMap.packages);
const steps = process.argv.includes('--run-clean') ? cleanSteps(subjectKind) : [];
const coverage = { packages: packageMap.packages.length, firstPartyMods: packageMap.packages.filter(({ class: kind }) => kind === 'user-toggleable-mod-package').length, ownershipAssignments: ownership.assignments.length,
  releaseArtifacts: release.artifactCount, physicalMods: physical.counts.physical, platformPassed: platform.summary.passed, platformExternallyBlocked: platform.summary.externallyBlocked,
  platformFailed: platform.summary.failed, measuredPerformanceSlices: performances.length };
const coveragePasses = (candidate) => candidate.packages === 49 && candidate.firstPartyMods === 36 && candidate.ownershipAssignments === 872
  && candidate.releaseArtifacts === 50 && candidate.physicalMods === 36 && candidate.platformPassed === 3 && candidate.platformExternallyBlocked === 9
  && candidate.platformFailed === 0 && candidate.measuredPerformanceSlices === 8;
const performancePasses = (evidence) => {
  if (evidence.passed === true) return true;
  if (evidence.passed !== undefined) return false;
  const greenBudgets = Object.entries(evidence.budgets ?? {}).filter(([key]) => key.endsWith('Green'));
  return greenBudgets.length > 0 && greenBudgets.every(([, value]) => value === true);
};
if (process.argv.includes('--self-test')) {
  if (!coveragePasses(coverage)) throw new Error('S9 coverage baseline is not green');
  if (coveragePasses({ ...coverage, platformPassed: 0, platformExternallyBlocked: 12 })) throw new Error('S9 coverage accepted an all-blocked platform matrix');
  if (!performances.every(performancePasses)) throw new Error('S9 performance baseline is not green');
  if (performancePasses({ budgets: { latencyGreen: true, memoryGreen: false } })) throw new Error('S9 performance accepted a red named budget');
  if (performancePasses({ budgets: { latencyMs: 10 } })) throw new Error('S9 performance accepted evidence without a verdict');
  console.log('S9 qualification negative controls passed');
  rmSync(runtimeRoot, { recursive: true, force: true });
  process.exit(0);
}
const receipt = { schemaVersion: 1, qualification: 'modular-agon-slice9-release-candidate', subject: { kind: subjectKind, hash: expectedHash, indexHash, commitHash, indexEqualsCommit: indexHash === commitHash }, contamination, graph, coverage, reviewEvidence, cleanCheckoutSteps: steps };
receipt.passed = Object.values(contamination).every((paths) => paths.length === 0) && (subjectKind === 'index' || indexHash === commitHash) && reviewEvidence.passed
  && graph.duplicateEdges.length === 0 && graph.uniqueEdges === 151 && coveragePasses(coverage)
  && performances.every(performancePasses)
  && steps.length > 0 && steps.every(({ passed }) => passed);
console.log(JSON.stringify(receipt, null, 2));
rmSync(runtimeRoot, { recursive: true, force: true });
if (!receipt.passed) process.exitCode = 1;
