import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';

const root = resolve(import.meta.dirname, '../..');
const prerequisiteBuilds = ["packages/mod-api", "packages/mod-kernel", "packages/support-engine-runtime"];
for (const workspace of prerequisiteBuilds) {
  const result = spawnSync("npm", ["run", "build", "-w", workspace], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, npm_config_ignore_scripts: "true" },
  });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error("mutation prerequisite build failed: " + workspace);
  }
}
const { spawnWithTimeout } = await import('@kernlang/agon-support-engine-runtime');
const gates = [
  [process.execPath, ['scripts/spec/verify-modular-generated-artifacts.mjs', '--self-test'], 'generated-artifact drift mutant'],
  [process.execPath, ['scripts/spec/verify-modular-slice1b-gates.mjs'], 'qualification/hash mutant set'],
  [process.execPath, ['scripts/spec/verify-modular-support-boundaries.mjs', '--self-test'], 'support dependency mutant'],
  [process.execPath, [
    'scripts/run-node22.mjs', resolve(root, 'node_modules/.bin/vitest'), 'run',
    'tests/unit/modular-manifest.test.ts',
    'tests/unit/modular-resolver.test.ts',
    'tests/unit/modular-registry.test.ts',
    'tests/unit/modular-package-graph.test.ts',
    'tests/unit/modular-topology-invariant.test.ts',
    'tests/unit/modular-boundary.test.ts',
  ], 'manifest/resolver/registry/graph behavioral regression suite'],
];

for (const [command, args, label] of gates) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', env: { ...process.env, npm_config_ignore_scripts: 'true' } });
  if (result.status !== 0) {
    console.error(result.stdout);
    console.error(result.stderr);
    throw new Error(`mutation gate failed: ${label}`);
  }
  console.log(`passed: ${label}`);
}
console.log(`all ${gates.length} verification suites passed`);

// Mutate a committed disposable checkout, never the operator's source files.
const mutants = [
  { id: 'manifest-unknown-fields', source: 'packages/mod-api/src/manifest.ts',
    before: '}).strict();\n\ntype DeepReadonly', after: '}).passthrough();\n\ntype DeepReadonly',
    test: 'tests/unit/modular-manifest.test.ts', title: 'accepts the frozen executable shape and rejects unknown fields' },
  { id: 'manifest-duplicate-dependency', source: 'packages/mod-api/src/manifest.ts',
    before: "assertUnique(dependencyIds, 'duplicate dependency id');", after: 'void dependencyIds;',
    test: 'tests/unit/modular-manifest.test.ts', title: 'rejects dependency ambiguity and invalid ranges' },
  { id: 'resolver-source-precedence', source: 'packages/mod-kernel/src/resolver.ts',
    before: 'bundled: 0,', after: 'bundled: 4,',
    test: 'tests/unit/modular-resolver.test.ts', title: 'selects source precedence before the highest compatible version' },
  { id: 'registry-duplicate-owner', source: 'packages/mod-kernel/src/registry.ts',
    before: 'if (this.#activeOwners.has(owner.id)) throw', after: 'if (false) throw',
    test: 'tests/unit/modular-registry.test.ts', title: 'rejects inactive registration and duplicate owner identity' },
  { id: 'canonical-lock-key-order', source: 'packages/mod-kernel/src/lock.ts',
    before: 'const keys = Object.keys(record).sort();', after: 'const keys = Object.keys(record);',
    test: 'tests/unit/modular-lock.test.ts', title: 'sorts object keys, normalizes negative zero, and rejects non-JSON values' },
  { id: 'public-api-private-boundary', source: 'packages/mod-api/src/index.ts',
    before: '', after: "\nimport type { ModRegistry as MutationOnlyRegistry } from '@kernlang/agon-kernel';\n",
    test: 'tests/unit/modular-boundary.test.ts', title: 'contains no kernel singleton or private Agon imports' },
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const scratch = mkdtempSync(join(tmpdir(), 'agon-foundation-mutations-'));
const receipt = { schemaVersion: 1, scope: 'six explicit foundation faults, not exhaustive mutation coverage',
  passed: false, subject: '', baseline: null, mutants: [], controls: {}, runs: [] };
function checked(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.signal || result.status !== 0) throw new Error(`${command} failed: ${result.error ?? result.stderr}`);
  return result.stdout.trim();
}
async function runAssertions(id, files) {
  const report = join(scratch, `${id}.json`);
  const result = await spawnWithTimeout({ command: process.execPath,
    args: ['scripts/run-node22.mjs', 'node_modules/vitest/vitest.mjs', 'run',
      ...files, '--no-cache', '--reporter=json', `--outputFile=${report}`],
    cwd: scratch, timeout: 120000, maxOutputBytes: 32 * 1024 * 1024,
    env: { ...process.env, HOME: join(scratch, '.runtime'), AGON_HOME: join(scratch, '.runtime/agon'),
      XDG_CONFIG_HOME: join(scratch, '.runtime/config'), XDG_CACHE_HOME: join(scratch, '.runtime/cache'),
      XDG_DATA_HOME: join(scratch, '.runtime/data'), XDG_STATE_HOME: join(scratch, '.runtime/state'),
      npm_config_cache: join(scratch, '.runtime/npm-cache'), npm_config_ignore_scripts: 'true', npm_config_offline: 'true' },
  });
  if (result.pid) {
    try { process.kill(-result.pid, 'SIGKILL'); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
  const run = { id, exitCode: result.exitCode, timedOut: result.timedOut, stdout: result.stdout, stderr: result.stderr };
  receipt.runs.push(run);
  if (result.timedOut || ![0, 1].includes(result.exitCode) || result.stderr.startsWith('Process output exceeded ')) {
    throw new Error(`${id}: test infrastructure failed: ${result.stderr}`);
  }
  const bytes = readFileSync(report);
  run.rawReport = bytes.toString('utf8');
  run.reportSha256 = hash(bytes);
  const parsed = JSON.parse(bytes);
  if (!Array.isArray(parsed.testResults) || parsed.testResults.some(suite => !suite.assertionResults?.length || suite.message)
    || /Unhandled Errors|Unhandled Rejection|Uncaught Exception/.test(result.stderr)) throw new Error(`${id}: invalid or runtime-error test report`);
  const assertions = parsed.testResults.flatMap(suite => suite.assertionResults ?? []);
  if (!assertions.length || assertions.length !== parsed.numTotalTests
    || assertions.filter(row => row.status === 'failed').length !== parsed.numFailedTests) throw new Error(`${id}: incomplete assertion report`);
  return { exitCode: result.exitCode, reportSha256: hash(bytes), success: parsed.success,
    suiteMessages: parsed.testResults.map(suite => suite.message),
    assertions: assertions.map(({ fullName, title, status, failureMessages }) => ({ fullName, title, status, failureMessages })) };
}
function killedByExpectedAssertion(result, title) {
  const expected = result.assertions.filter(row => row.title === title);
  return result.exitCode === 1 && result.success === false && expected.length === 1
    && expected[0].status === 'failed' && expected[0].failureMessages.some(message => message.includes('AssertionError:'));
}
try {
  receipt.subject = checked('git', ['rev-parse', 'HEAD']);
  const inputs = [...new Set(mutants.flatMap(mutant => [mutant.source, mutant.test]))];
  if (checked('git', ['diff', 'HEAD', '--', 'packages', 'tests', 'package.json', 'package-lock.json', 'vitest.config.ts', 'scripts/run-node22.mjs'])) {
    throw new Error('mutation runtime and tests must match the committed subject');
  }
  const archive = join(scratch, 'subject.tar');
  checked('git', ['archive', '--format=tar', `--output=${archive}`, receipt.subject]);
  checked('tar', ['-xf', archive, '-C', scratch]);
  rmSync(archive);
  symlinkSync(join(root, 'node_modules'), join(scratch, 'node_modules'), 'dir');
  mkdirSync(join(scratch, '.runtime'), { recursive: true });
  const originalInputs = new Map(inputs.map(path => [path, readFileSync(join(scratch, path))]));
  receipt.baseline = await runAssertions('baseline', [...new Set(mutants.map(mutant => mutant.test))]);
  if (receipt.baseline.exitCode !== 0 || !receipt.baseline.success || receipt.baseline.assertions.some(row => row.status !== 'passed')) {
    throw new Error('committed mutation baseline is not entirely green');
  }
  for (const mutant of mutants) {
    const path = join(scratch, mutant.source);
    const source = readFileSync(path, 'utf8');
    if (mutant.before && source.split(mutant.before).length !== 2) throw new Error(`${mutant.id}: mutation anchor is not unique`);
    const changed = mutant.before ? source.replace(mutant.before, mutant.after) : source + mutant.after;
    if (changed === source) throw new Error(`${mutant.id}: mutation did not change source`);
    writeFileSync(path, changed);
    let result;
    try { result = await runAssertions(mutant.id, [mutant.test]); }
    finally { writeFileSync(path, source); }
    const killed = killedByExpectedAssertion(result, mutant.title);
    receipt.mutants.push({ ...mutant, originalSha256: hash(source), mutatedSha256: hash(changed), killed, result });
    if (!killed) throw new Error(`${mutant.id}: expected assertion did not kill the mutation`);
  }
  const survivor = await runAssertions('survivor-control', [mutants[0].test]);
  receipt.controls.survivorRejected = survivor.exitCode === 0 && survivor.success === true
    && !killedByExpectedAssertion(survivor, mutants[0].title);
  const brokenPath = join(scratch, mutants[0].source);
  const original = readFileSync(brokenPath, 'utf8');
  try {
    writeFileSync(brokenPath, original + '\nconst = ;\n');
    try { await runAssertions('syntax-control', [mutants[0].test]); }
    catch (error) {
      receipt.controls.syntaxFailureRejected = String(error).includes('invalid or runtime-error test report');
    }
  } finally { writeFileSync(brokenPath, original); }
  const hookPath = join(scratch, mutants[0].test);
  const hookOriginal = readFileSync(hookPath, 'utf8');
  try {
    writeFileSync(brokenPath, original.replace(mutants[0].before, mutants[0].after));
    writeFileSync(hookPath, hookOriginal + "\nimport { afterAll as mutationAfterAll } from 'vitest';\nmutationAfterAll(() => { throw new Error('mutation teardown control'); });\n");
    try {
      receipt.controls.hookRun = await runAssertions('hook-control', [mutants[0].test]);
      receipt.controls.hookFailureRejected = false;
    } catch (error) {
      receipt.controls.hookFailureRejected = String(error).includes('invalid or runtime-error test report');
    }
  } finally { writeFileSync(brokenPath, original); writeFileSync(hookPath, hookOriginal); }
  for (const path of inputs) {
    if (!readFileSync(join(scratch, path)).equals(originalInputs.get(path))) throw new Error(`mutation source was not restored: ${path}`);
  }
  if (receipt.controls.survivorRejected !== true || receipt.controls.syntaxFailureRejected !== true
    || receipt.controls.hookFailureRejected !== true) throw new Error('mutation evaluator negative controls failed');
  receipt.passed = receipt.mutants.length === mutants.length && receipt.mutants.every(mutant => mutant.killed);
} catch (error) {
  receipt.error = String(error?.stack ?? error);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
console.log(JSON.stringify(receipt, null, 2));
if (!receipt.passed) process.exitCode = 1;
