import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { VerificationContractSchema, VerificationReceiptSchema } from '../../docs/specs/fixtures/modular-agon-contracts/contracts.mjs';

const root = resolve(import.meta.dirname, '../..');
const evidenceDir = join(root, 'docs/specs/evidence');
const logDir = join(evidenceDir, 'verification-logs');
mkdirSync(logDir, { recursive: true });
const isolated = mkdtempSync(join(tmpdir(), 'agon-modular-verification-'));
const platform = `${process.platform}-${process.arch}`;
const hash = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;
const specFiles = [
  'docs/specs/modular-agon-overview.md', 'docs/specs/modular-agon-runtime-contract.md', 'docs/specs/modular-agon-security-and-distribution.md',
  'docs/specs/modular-agon-authoring-build-and-packaging.md', 'docs/specs/modular-agon-blast-radius-and-readiness.md',
  'docs/specs/modular-agon-migration-and-verification.md', 'docs/specs/modular-agon-contracts-and-evidence.md',
];
const commands = [
  ['inventory', 'command', ['node', 'scripts/spec/generate-modular-agon-inventory.mjs']],
  ['ownership-and-dag', 'command', ['node', 'scripts/spec/generate-modular-agon-ownership.mjs']],
  ['fixtures', 'command', ['node', 'scripts/spec/generate-modular-agon-fixtures.mjs']],
  ['json-schemas', 'schema', ['node', 'scripts/spec/generate-modular-agon-schemas.mjs']],
  ['coverage-ledger', 'schema', ['node', 'scripts/spec/generate-modular-agon-coverage-ledger.mjs']],
  ['contract-properties', 'property', ['npx', 'vitest', 'run', 'tests/spec/modular-agon-contracts.test.ts']],
  ['external-example-compile', 'command', ['npx', 'tsc', '-p', 'docs/specs/fixtures/modular-agon-contracts/example-mod/tsconfig.json']],
  ['pack-content', 'pack', ['node', 'scripts/spec/check-modular-agon-pack.mjs']],
  ['consistency-and-links', 'property', ['node', 'scripts/spec/check-modular-agon-consistency.mjs']],
  ['repository-typecheck', 'command', ['npm', 'run', 'typecheck']],
  ['reexport-guard', 'command', ['npm', 'run', 'guard:reexports']],
  ['spec-lint', 'command', ['npx', 'eslint', 'scripts/spec', 'tests/spec', '--max-warnings', '0']],
  ['full-test-suite', 'command', ['npm', 'test']],
];
const contract = VerificationContractSchema.parse({
  schemaVersion: 1, id: 'agon.verify.spec-readiness', version: '1.0.0', owner: 'agon.kernel',
  platforms: ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64'],
  checks: commands.map(([id, kind, command]) => ({ id, authority: 'host', kind, command, timeoutMs: 1_200_000, maxOutputBytes: 64 * 1024 * 1024, evidence: [`docs/specs/evidence/verification-logs/${id}.log`] })),
});
const contractPath = join(evidenceDir, 'modular-agon-verification-contract.json');
writeFileSync(contractPath, `${JSON.stringify(contract, null, 2)}\n`);
const receiptsPath = join(evidenceDir, 'modular-agon-verification-receipts.json');
writeFileSync(receiptsPath, `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), receipts: [] }, null, 2)}\n`);

const env = {
  ...process.env, AGON_HOME: join(isolated, 'agon-home'), HOME: join(isolated, 'home'), XDG_CONFIG_HOME: join(isolated, 'home/.config'),
  npm_config_cache: join(isolated, 'npm-cache'), npm_config_update_notifier: 'false', NO_COLOR: '1', CI: '1',
};
const checks = []; const startedAt = new Date().toISOString();
try {
  for (const [id, , command] of commands) {
    const started = performance.now();
    const result = spawnSync(command[0], command.slice(1), { cwd: root, env, encoding: 'utf8', timeout: 1_200_000, maxBuffer: 64 * 1024 * 1024 });
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    const log = `command: ${JSON.stringify(command)}\nexitCode: ${result.status}\nsignal: ${result.signal ?? 'none'}\nerror: ${result.error?.message ?? 'none'}\n\n${output}\n`;
    const logPath = join(logDir, `${id}.log`); writeFileSync(logPath, log);
    const passed = result.status === 0 && !result.error;
    checks.push({ id, status: passed ? 'passed' : 'failed', exitCode: result.status, durationMs: performance.now() - started, evidenceHashes: [hash(log)], ...(passed ? {} : { note: result.error?.message ?? `command exited ${result.status}` }) });
  }
  const subjectHash = hash(specFiles.map((file) => `${file}\0${readFileSync(join(root, file))}`).join('\0'));
  const receipt = VerificationReceiptSchema.parse({
    schemaVersion: 1, receiptId: randomUUID(), contractId: contract.id, contractVersion: contract.version,
    contractHash: hash(readFileSync(contractPath)), subjectHash, runner: { id: 'agon.verify.runner', version: '1.0.0', contentHash: hash(readFileSync(new URL(import.meta.url))) }, platform, startedAt, finishedAt: new Date().toISOString(),
    status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed', checks,
  });
  writeFileSync(receiptsPath, `${JSON.stringify({ schemaVersion: 1, generatedAt: new Date().toISOString(), receipts: [receipt] }, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, checks: Object.fromEntries(checks.map((check) => [check.id, check.status])), receiptId: receipt.receiptId }, null, 2));
  if (receipt.status !== 'passed') process.exitCode = 1;
} finally {
  rmSync(isolated, { recursive: true, force: true });
}
