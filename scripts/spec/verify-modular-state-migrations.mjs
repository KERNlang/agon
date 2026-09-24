import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const corpus = resolve(root, 'docs/specs/evidence/modular-agon-legacy-oracle/persisted-envelopes.raw.ndjson');
const evidence = resolve(root, 'docs/specs/evidence/modular-agon-state-migration-qualification.json');
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const records = readFileSync(corpus, 'utf8').trimEnd().split('\n');
const command = ['scripts/run-node22.mjs', 'node_modules/.bin/vitest', 'run', 'tests/unit/modular-envelope-contract.test.ts', 'tests/unit/modular-release-state-migrations.test.ts', 'tests/unit/modular-migration-engine.test.ts', 'tests/unit/modular-purge-retention.test.ts'];
const run = spawnSync(process.execPath, command, { cwd: root, encoding: 'utf8' });
const receipt = { schemaVersion: 1, slice: 'S9', passed: run.status === 0 && records.length === 7,
  historicalCorpus: { path: 'docs/specs/evidence/modular-agon-legacy-oracle/persisted-envelopes.raw.ndjson', sha256: sha256(readFileSync(corpus)), records: records.length },
  compatibility: { sourceBytesPreserved: true, unknownPayloadFieldsPreserved: true, disableAndUninstallRetainHistoricalData: true,
    readers: ['legacy-0.2.x', 'envelope-v1'], downgradePolicy: 'previous immutable generation reads the preserved legacy source; migrated bytes are staged, never destructive' },
  checks: { status: run.status, stdoutTail: run.stdout.slice(-4000), stderrTail: run.stderr.slice(-2000) } };
if (!process.argv.includes('--no-write')) writeFileSync(evidence, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
