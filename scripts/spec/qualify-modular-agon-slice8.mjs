import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { collectSubjectContamination, hashGitSubject, isSourceBearingPath, validateDependencyGraph, validateSubjectBoundReview } from './slice1b-qualification-gates.mjs';

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const runtimeRoot = mkdtempSync(join(tmpdir(), 'agon-modular-s8-runtime-'));
const excluded = ['docs/specs/evidence/modular-agon-slice8-review-evidence.json', 'docs/specs/evidence/modular-agon-slice8-verification-receipt.json'];
const excludedPrefixes = ['docs/specs/evidence/verification-logs/slice8/'];

function run(command, args, cwd = root) {
  return spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 96 * 1024 * 1024, env: { ...process.env, AGON_HOME: join(runtimeRoot, 'agon-home'), npm_config_cache: process.env.AGON_QUALIFICATION_NPM_CACHE ?? join(runtimeRoot, 'npm-cache'), npm_config_logs_dir: join(runtimeRoot, 'npm-logs'), npm_config_ignore_scripts: 'true', NODE_OPTIONS: '--max-old-space-size=8192' } });
}

function init(checkout) {
  for (const args of [['init', '--quiet'], ['add', '--all', '--force'], ['-c', 'user.name=Agon Qualification', '-c', 'user.email=qualification', 'commit', '--quiet', '-m', 'qualification subject']]) {
    const result = run('git', args, checkout);
    if (result.status !== 0) throw new Error(result.stderr || `git ${args[0]} failed`);
  }
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
  init(checkout);
}

function cleanSteps(subject) {
  const checkout = mkdtempSync(join(tmpdir(), `agon-modular-s8-${subject}-`));
  const steps = [];
  try {
    materialize(checkout, subject);
    const commands = [
      ['npm-ci', 'npm', ['ci', '--ignore-scripts', '--offline']],
      ['clean-build', 'npm', ['run', 'build:cli:workspaces']],
      ['slice8-behavioral-security', 'npm', ['run', 'test:modular-slice8']],
      ['slice8-structural-drift-controls', 'npm', ['run', 'spec:modular-slice8:self-test']],
      ['runtime-version-drift', 'node', ['scripts/spec/verify-modular-runtime-version.mjs', '--self-test']],
      ['external-example-drift', 'node', ['scripts/spec/verify-folder-mod-example-drift.mjs']],
      ['folder-mod-cli-e2e', 'npm', ['run', 'spec:modular-slice8:e2e']],
      ['slice8-performance', 'npm', ['run', 'perf:modular-slice8', '--', '--no-write']],
      ['typecheck', 'npm', ['run', 'typecheck']],
      ['lint', 'npm', ['run', 'lint']],
      ['full-suite', 'npm', ['run', 'test:ts']],
      ['generated-artifacts', 'npm', ['run', 'spec:modular-generated:check']],
      ['spec-consistency', 'node', ['scripts/spec/check-modular-agon-consistency.mjs']],
      ['roadmap-contract', 'node', ['scripts/spec/verify-modular-agon-roadmap.mjs']],
      ['legacy-oracle', 'npm', ['run', 'test:modular-legacy-oracle']],
      ['oracle-negative-controls', 'npm', ['run', 'test:modular-oracle-boundary']],
    ];
    for (const [id, command, args] of commands) {
      const result = run(command, args, checkout);
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      steps.push({ id, command: [command, ...args], status: result.status, passed: result.status === 0, outputTail: output.slice(-4000) });
      if (result.status !== 0) break;
    }
    if (steps.every(({ passed }) => passed)) {
      const finalContamination = collectSubjectContamination(checkout, ['.']);
      const ignoredSourceBearing = finalContamination.ignored.filter((path) => isSourceBearingPath(path));
      steps.push({ id: 'final-ignored-source-contamination', command: ['git', 'ls-files', '--others', '--ignored', '--exclude-standard'],
        status: ignoredSourceBearing.length ? 1 : 0, passed: ignoredSourceBearing.length === 0, outputTail: JSON.stringify(ignoredSourceBearing) });
    }
    if (steps.every(({ passed }) => passed)) {
      const result = run('git', ['status', '--porcelain', '--untracked-files=all'], checkout);
      const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      steps.push({ id: 'final-clean-worktree', command: ['git', 'status', '--porcelain', '--untracked-files=all'],
        status: result.status, passed: result.status === 0 && output.trim() === '', outputTail: output.slice(-4000) });
    }
  } finally { rmSync(checkout, { recursive: true, force: true }); }
  return steps;
}

const subjectKind = process.argv.includes('--subject=commit') ? 'commit' : 'index';
const allContamination = collectSubjectContamination(root, ['.']);
const contamination = Object.fromEntries(Object.entries(allContamination).map(([kind, paths]) => [kind, paths.filter((path) => isSourceBearingPath(path, { nonSourcePaths: excluded }))]));
const indexHash = hashGitSubject(root, { kind: 'index', pathspecs: ['.'], excludedPaths: excluded, excludedPathPrefixes: excludedPrefixes });
const commitHash = hashGitSubject(root, { kind: 'commit', revision: 'HEAD', pathspecs: ['.'], excludedPaths: excluded, excludedPathPrefixes: excludedPrefixes });
const expectedHash = subjectKind === 'index' ? indexHash : commitHash;
const reviewPath = join(root, 'docs/specs/evidence/modular-agon-slice8-review-evidence.json');
const reviewEvidence = existsSync(reviewPath) ? validateSubjectBoundReview(root, JSON.parse(readFileSync(reviewPath, 'utf8')), { kind: subjectKind, revision: 'HEAD', hash: expectedHash }) : { passed: false, reason: 'S8 review evidence is missing' };
const packageMap = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-package-map.json'), 'utf8'));
const graph = validateDependencyGraph(packageMap.packages);
const steps = process.argv.includes('--run-clean') ? cleanSteps(subjectKind) : [];
const receipt = { schemaVersion: 1, qualification: 'modular-agon-slice8-clean-checkout', subject: { kind: subjectKind, hash: expectedHash, indexHash, commitHash, indexEqualsCommit: indexHash === commitHash }, contamination, graph, coverage: { behavioralSecuritySuites: ['trust-and-grants', 'third-party-lifecycle', 'bounded-discovery', 'canonical-resolution', 'dynamic-mcp-cesar', 'transaction-recovery'], structuralDriftVerifier: 'spec:modular-slice8:self-test', cliEndToEndVerifier: 'spec:modular-slice8:e2e', verifierCountsAreRuntimeDerived: true, trustModel: 'full-code-not-sandboxed', externalExampleDriftChecked: true, trustAndActivationSeparate: true, transactionalAuthority: true, immutableActivationSnapshot: true, measuredPerformance: true }, reviewEvidence, cleanCheckoutSteps: steps };
receipt.passed = Object.values(contamination).every((paths) => paths.length === 0) && (subjectKind === 'index' || indexHash === commitHash) && reviewEvidence.passed && graph.duplicateEdges.length === 0 && graph.uniqueEdges === 144 && steps.length > 0 && steps.every(({ passed }) => passed);
console.log(JSON.stringify(receipt, null, 2));
rmSync(runtimeRoot, { recursive: true, force: true });
if (!receipt.passed) process.exitCode = 1;
