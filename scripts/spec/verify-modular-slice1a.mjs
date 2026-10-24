import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { boundEvidenceOutput, computeSubjectHash, findUntrackedSubjectFiles, sha256, validateReviewEvidence } from './slice1a-qualification-gates.mjs';

const root = resolve(import.meta.dirname, '../..');
const evidenceRoot = join(root, 'docs/specs/evidence');
const logRoot = join(evidenceRoot, 'verification-logs');
const isolationRoot = mkdtempSync(join(tmpdir(), 'agon-slice1a-verify-'));
mkdirSync(logRoot, { recursive: true });

const representativeTests = [
  'tests/integration/workflow-pipeline-call.test.ts',
  'tests/integration/workflow-pipeline-slash.test.ts',
  'tests/integration/forge-e2e.test.ts',
  'tests/unit/thinking.test.ts',
  'tests/unit/tribunal-modes.test.ts',
  'tests/unit/brainstorm-dedup.test.ts',
  'tests/unit/review-roles.test.ts',
  'tests/unit/rag-core.test.ts',
  'tests/unit/rooms.test.ts',
  'tests/unit/daemon-workflow-job.test.ts',
];

const commands = [
  ['build', ['npm', 'run', 'build']],
  ['typecheck', ['npm', 'run', 'typecheck']],
  ['lint', ['npm', 'run', 'lint']],
  ['reexport-guard', ['npm', 'run', 'guard:reexports']],
  ['slice1a-contracts', ['npm', 'run', 'test:modular-slice1a']],
  ['slice1a-performance', ['npm', 'run', 'perf:modular-slice1a']],
  ['full-repository-suite', ['npm', 'test']],
  ['representative-workflows', ['node', 'scripts/run-node22.mjs', 'node_modules/vitest/vitest.mjs', 'run', ...representativeTests]],
  ['diff-check', ['git', 'diff', '--check', '--', '.', ':(exclude)docs/specs/evidence/verification-logs']],
  ['cached-diff-check', ['git', 'diff', '--cached', '--check', '--', '.', ':(exclude)docs/specs/evidence/verification-logs']],
];

const environment = {
  ...process.env,
  AGON_HOME: join(isolationRoot, 'agon-home'),
  HOME: join(isolationRoot, 'home'),
  XDG_CONFIG_HOME: join(isolationRoot, 'home', '.config'),
  npm_config_cache: join(isolationRoot, 'npm-cache'),
  npm_config_ignore_scripts: 'true',
  npm_config_update_notifier: 'false',
  NO_COLOR: '1',
};
for (const path of [environment.AGON_HOME, environment.HOME, environment.XDG_CONFIG_HOME, environment.npm_config_cache]) {
  mkdirSync(path, { recursive: true });
}


const checks = [];
const startedAt = new Date().toISOString();
try {
  for (const [id, command] of commands) {
    const started = performance.now();
    const result = spawnSync(command[0], command.slice(1), {
      cwd: root,
      env: environment,
      encoding: 'utf8',
      timeout: 1_200_000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trimEnd();
    const boundedOutput = boundEvidenceOutput(output);
    const log = `command: ${JSON.stringify(command)}\nexitCode: ${result.status}\nsignal: ${result.signal ?? 'none'}\nerror: ${result.error?.message ?? 'none'}\noutputBytes: ${boundedOutput.originalBytes}\noutputHash: ${boundedOutput.originalHash}\noutputTruncated: ${boundedOutput.truncated}\n\n${boundedOutput.text}\n`;
    const logPath = join(logRoot, `slice1a-${id}.log`);
    writeFileSync(logPath, log);
    checks.push({
      id,
      status: result.status === 0 && !result.error ? 'passed' : 'failed',
      exitCode: result.status,
      durationMs: performance.now() - started,
      evidence: relative(root, logPath),
      evidenceHash: sha256(log),
      ...(result.error ? { error: result.error.message } : {}),
    });
  }

  const subjectHash = computeSubjectHash(root);

  const untrackedFiles = findUntrackedSubjectFiles(root);
  checks.push({
    id: 'subject-untracked-check', status: untrackedFiles.length === 0 ? 'passed' : 'failed', exitCode: untrackedFiles.length === 0 ? 0 : 1,
    durationMs: 0, evidence: untrackedFiles, evidenceHash: sha256(untrackedFiles.join('\n')),
  });

  const reviewEvidence = join(evidenceRoot, 'modular-agon-slice1a-review-evidence.json');
  let reviewResult = { passed: false, reason: 'review evidence is missing' };
  try {
    reviewResult = validateReviewEvidence(JSON.parse(readFileSync(reviewEvidence, 'utf8')), subjectHash);
  } catch (error) {
    reviewResult = { passed: false, reason: error instanceof Error ? error.message : String(error) };
  }
  checks.push({
    id: 'independent-review-evidence', status: reviewResult.passed ? 'passed' : 'failed', exitCode: reviewResult.passed ? 0 : 1, durationMs: 0,
    evidence: relative(root, reviewEvidence), evidenceHash: existsSync(reviewEvidence) ? sha256(readFileSync(reviewEvidence)) : sha256('missing'),
    ...(reviewResult.reason ? { error: reviewResult.reason } : {}),
  });
  const receipt = {
    schemaVersion: 1,
    receiptId: randomUUID(),
    kind: 'modular-agon-slice1a-qualification',
    branch: 'feat/modular-agon-slice-1a',
    platform: `${process.platform}-${process.arch}`,
    node: process.version,
    startedAt,
    finishedAt: new Date().toISOString(),
    subjectHash,
    isolation: { agonHome: 'temporary', home: 'temporary', npmCache: 'temporary', activeAgonMutated: false },
    status: checks.every(({ status }) => status === 'passed') ? 'passed' : 'failed',
    checks,
  };
  writeFileSync(join(evidenceRoot, 'modular-agon-slice1a-verification-receipt.json'), `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, receiptId: receipt.receiptId, checks: Object.fromEntries(checks.map(({ id, status }) => [id, status])) }, null, 2));
  if (receipt.status !== 'passed') process.exitCode = 1;
} finally {
  rmSync(isolationRoot, { recursive: true, force: true });
}
