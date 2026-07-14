#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { prepareCandidate, printResolution, resolveKernCli } from './kern-cli-resolver.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export function compareKernSelfCoverage(report, policy) {
  const failures = [];
  const minimums = policy?.minimums ?? {};
  const maximums = policy?.maximums ?? {};

  for (const field of ['nativeHandlers', 'classifiedOrMigratablePct']) {
    const minimum = minimums[field];
    const actual = report?.[field];
    if (!Number.isFinite(minimum) || minimum < 0) {
      failures.push(`minimums.${field} must be numeric`);
    } else if (!Number.isFinite(actual) || actual < 0 || actual < minimum) {
      failures.push(`${field} ${String(actual)} is below baseline ${minimum}`);
    }
  }
  if (!Number.isFinite(report?.nativeAuthoredPct) || report.nativeAuthoredPct < 0) {
    failures.push('nativeAuthoredPct must be numeric');
  }

  for (const field of ['filesWithParseErrors', 'blockedHandlers']) {
    const maximum = maximums[field];
    const actual = report?.[field];
    if (!Number.isFinite(maximum) || maximum < 0) {
      failures.push(`maximums.${field} must be numeric`);
    } else if (!Number.isFinite(actual) || actual < 0 || actual > maximum) {
      failures.push(`${field} ${String(actual)} exceeds baseline ${maximum}`);
    }
  }

  const blockerEntries = Array.isArray(report?.blockers) ? report.blockers : [];
  if (!Array.isArray(report?.blockers)) failures.push('blockers must be an array');
  const blockerCounts = new Map();
  for (const entry of blockerEntries) {
    if (!entry || typeof entry !== 'object' || typeof entry.reason !== 'string') {
      failures.push('each blocker entry must contain a string reason');
      continue;
    }
    if (!Number.isFinite(entry.count) || entry.count < 0) {
      failures.push(`blocker ${entry.reason} count must be numeric`);
      continue;
    }
    blockerCounts.set(entry.reason, (blockerCounts.get(entry.reason) ?? 0) + entry.count);
  }
  const blockerMaximums = policy?.blockerMaximums;
  if (!blockerMaximums || typeof blockerMaximums !== 'object' || !Number.isFinite(blockerMaximums['foreign-missing-reason']) || blockerMaximums['foreign-missing-reason'] < 0) {
    failures.push('blockerMaximums.foreign-missing-reason must be numeric');
  }
  for (const reason of blockerCounts.keys()) {
    if (!Object.hasOwn(blockerMaximums ?? {}, reason)) {
      failures.push(`blocker ${reason} has no baseline ceiling`);
    }
  }
  for (const [reason, maximum] of Object.entries(blockerMaximums ?? {})) {
    const rawActual = blockerCounts.has(reason) ? blockerCounts.get(reason) : 0;
    if (!Number.isFinite(maximum) || maximum < 0) {
      failures.push(`blockerMaximums.${reason} must be numeric`);
    } else if (!Number.isFinite(rawActual) || rawActual < 0) {
      failures.push(`blocker ${reason} count must be numeric`);
    } else if (rawActual > maximum) {
      failures.push(`blocker ${reason} ${rawActual} exceeds baseline ${maximum}`);
    }
  }

  return failures;
}

export function parseKernJson(stdout) {
  try {
    return JSON.parse(stdout);
  } catch (error) {
    throw new Error(`kern self-coverage returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function main() {
  const policyPath = path.join(repoRoot, '.kern', 'self-coverage-baseline.json');
  const policy = JSON.parse(readFileSync(policyPath, 'utf8'));
  if (typeof policy?.root !== 'string' || !policy.root) {
    throw new Error('self-coverage policy root must be a non-empty string');
  }
  const selection = resolveKernCli(repoRoot);
  printResolution('kern:self-coverage', selection, selection.requiredVersion);
  prepareCandidate('kern:self-coverage', selection.candidate);

  const args = [
    ...selection.candidate.commandArgs,
    'self-coverage',
    policy.root,
    ...(policy.canonicalizeBraces ? ['--canonicalize-braces'] : []),
    '--json',
  ];
  const result = spawnSync(selection.candidate.command, args, {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? result.stderr?.trim() ?? `exit ${String(result.status)}`;
    throw new Error(`kern self-coverage failed: ${detail}`);
  }

  const report = parseKernJson(result.stdout);
  const failures = compareKernSelfCoverage(report, policy);
  if (failures.length > 0) {
    console.error('KERN self-coverage regression:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  console.log(`KERN self-coverage green: ${report.nativeHandlers} native handlers (${report.nativeAuthoredPct}%) · ${report.classifiedOrMigratablePct}% classified/migratable · ${report.blockedHandlers} blocked · ${report.filesWithParseErrors} parse errors`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main();
