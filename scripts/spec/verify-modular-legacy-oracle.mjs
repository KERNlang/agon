import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.env.AGON_LEGACY_ORACLE_ROOT ?? new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const evidenceRoot = join(root, 'docs/specs/evidence/modular-agon-legacy-oracle');
const manifest = JSON.parse(readFileSync(join(evidenceRoot, 'manifest.json'), 'utf8'));
const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const errors = [];
const check = (condition, message) => { if (!condition) errors.push(message); };

for (const artifact of manifest.artifacts ?? []) {
  const path = join(root, artifact.path);
  let bytes;
  try { bytes = readFileSync(path); } catch { errors.push(`missing oracle artifact: ${artifact.path}`); continue; }
  check(sha256(bytes) === artifact.sha256, `oracle artifact hash mismatch: ${artifact.path}`);
}

const workflowReport = JSON.parse(readFileSync(join(evidenceRoot, 'representative-workflows.raw.json'), 'utf8'));
const assertions = workflowReport.testResults.flatMap((suite) => suite.assertionResults ?? []);
check(workflowReport.success === true, 'raw representative workflow capture is not green');
check(workflowReport.numTotalTests === 160 && workflowReport.numPassedTests === 160 && workflowReport.numFailedTests === 0, 'raw representative workflow capture must be exactly 160/160');
check(assertions.length === 160 && new Set(assertions.map(({ fullName }) => fullName)).size === 160, 'workflow oracle must contain 160 unique named assertions');
check(assertions.every(({ status }) => status === 'passed'), 'workflow oracle contains a non-passing assertion');

const rawLines = readFileSync(join(evidenceRoot, 'persisted-envelopes.raw.ndjson'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
check(rawLines.some((entry) => entry._type === 'header'), 'raw chat header envelope missing');
check(rawLines.some((entry) => entry.role === 'user') && rawLines.some((entry) => entry.role === 'engine'), 'raw chat message envelopes missing');
check(rawLines.some((entry) => entry.type === 'result' && entry.is_error === false), 'raw success result envelope missing');
check(rawLines.some((entry) => entry.type === 'result' && entry.is_error === true), 'raw failure result envelope missing');
check(rawLines.some((entry) => entry.seq === 1 && entry.roomId === 'oracle-room'), 'raw room event envelope missing');
check(rawLines.some((entry) => entry.event?.type === 'tool-call'), 'raw archived tool event missing');
check(rawLines.some((entry) => JSON.stringify(entry).includes('oracle-secret-value')), 'raw pre-redaction witness missing');

for (const stage of ['normalization', 'redaction', 'formatting', 'rendering']) {
  const tests = manifest.transformStageTests?.[stage];
  check(Array.isArray(tests) && tests.length > 0, `${stage} lacks a separate test owner`);
  for (const path of tests ?? []) {
    try { readFileSync(join(root, path)); } catch { errors.push(`${stage} test owner missing: ${path}`); }
  }
}

if (errors.length > 0) {
  console.error(errors.map((error) => `- ${error}`).join('\n'));
  process.exit(1);
}
console.log(JSON.stringify({ workflows: assertions.length, rawEnvelopes: rawLines.length, transformStages: Object.keys(manifest.transformStageTests).length, status: 'passed' }, null, 2));
