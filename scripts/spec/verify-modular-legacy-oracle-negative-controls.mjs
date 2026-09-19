import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = new URL('../..', import.meta.url).pathname.replace(/\/$/, '');
const temp = mkdtempSync(join(tmpdir(), 'agon-legacy-oracle-negative-'));
const run = () => spawnSync(process.execPath, [join(root, 'scripts/spec/verify-modular-legacy-oracle.mjs')], {
  cwd: root,
  env: { ...process.env, AGON_LEGACY_ORACLE_ROOT: temp },
  encoding: 'utf8',
});

try {
  cpSync(join(root, 'docs/specs/evidence/modular-agon-legacy-oracle'), join(temp, 'docs/specs/evidence/modular-agon-legacy-oracle'), { recursive: true });
  for (const path of [
    'tests/unit/normalize-base-url.test.ts',
    'tests/unit/context-thread.test.ts',
    'tests/unit/chat-store.test.ts',
    'tests/unit/tool-parser.test.ts',
    'tests/unit/banner-branding.test.ts',
  ]) {
    mkdirSync(dirname(join(temp, path)), { recursive: true });
    cpSync(join(root, path), join(temp, path));
  }
  assert.equal(run().status, 0, 'unmodified oracle fixture must pass');

  const workflowPath = join(temp, 'docs/specs/evidence/modular-agon-legacy-oracle/representative-workflows.raw.json');
  const originalWorkflow = readFileSync(workflowPath, 'utf8');
  const workflow = JSON.parse(originalWorkflow);
  workflow.success = false;
  writeFileSync(workflowPath, JSON.stringify(workflow));
  assert.notEqual(run().status, 0, 'a false workflow success flag must make the oracle red');
  writeFileSync(workflowPath, originalWorkflow);

  const envelopePath = join(temp, 'docs/specs/evidence/modular-agon-legacy-oracle/persisted-envelopes.raw.ndjson');
  const originalEnvelopes = readFileSync(envelopePath, 'utf8');
  writeFileSync(envelopePath, originalEnvelopes.replace('oracle-secret-value', '[REDACTED]'));
  assert.notEqual(run().status, 0, 'redacting before raw capture must make the oracle red');
  writeFileSync(envelopePath, originalEnvelopes);

  const manifestPath = join(temp, 'docs/specs/evidence/modular-agon-legacy-oracle/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.artifacts[0].sha256 = `sha256:${'0'.repeat(64)}`;
  writeFileSync(manifestPath, JSON.stringify(manifest));
  assert.notEqual(run().status, 0, 'an artifact hash mismatch must make the oracle red');
  console.log('Legacy oracle negative controls passed');
} finally {
  rmSync(temp, { recursive: true, force: true });
}
