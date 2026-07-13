#!/usr/bin/env node

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareCandidate, printResolution, resolveKernCli } from './kern-cli-resolver.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

export function compareKernNativeCoverage(summary, policy) {
  const failures = [];
  const minimumCoveragePct = policy?.minimums?.nativeCoveragePct;
  const minimumCoverageUnits = policy?.minimums?.nativeCoverageUnits;

  if (typeof policy?.root !== 'string' || !policy.root) failures.push('policy root must be a non-empty string');
  if (typeof minimumCoveragePct !== 'number') failures.push('policy minimums.nativeCoveragePct must be numeric');
  if (typeof minimumCoverageUnits !== 'number') failures.push('policy minimums.nativeCoverageUnits must be numeric');
  if (!summary || typeof summary !== 'object') {
    failures.push('native test summary is missing');
    return failures;
  }

  const coverage = summary.coverage;
  if (typeof summary.total !== 'number') failures.push('summary.total must be numeric');
  else if (summary.total === 0) failures.push('no native KERN tests were discovered');
  if (typeof summary.failed !== 'number') failures.push('summary.failed must be numeric');
  else if (summary.failed > 0) failures.push(`${summary.failed} native assertion(s) failed`);
  if (typeof coverage?.percent !== 'number' || (typeof minimumCoveragePct === 'number' && coverage.percent < minimumCoveragePct)) {
    failures.push(`coverage ${String(coverage?.percent)}% is below ${String(minimumCoveragePct)}%`);
  }
  if (typeof coverage?.total !== 'number' || (typeof minimumCoverageUnits === 'number' && coverage.total < minimumCoverageUnits)) {
    failures.push(`coverage denominator ${String(coverage?.total)} is below ${String(minimumCoverageUnits)}`);
  }
  return failures;
}

function formatCoverage(summary, root) {
  const coverage = summary.coverage;
  const lines = [
    `kern test ${root} - ${summary.passed} passed, ${summary.warnings} warnings, ${summary.failed} failed, ${summary.total} total`,
    `coverage ${coverage.covered}/${coverage.total} (${coverage.percent}%)`,
  ];
  for (const key of ['transitions', 'guards', 'routes', 'tools', 'effects']) {
    const metric = coverage?.[key];
    lines.push(`${key}: ${String(metric?.covered)}/${String(metric?.total)} (${String(metric?.percent)}%)`);
  }
  return lines.join('\n');
}

function formatFailedAssertions(summary) {
  return (summary?.files ?? [])
    .flatMap((file) => file.results ?? [])
    .filter((result) => result?.status === 'failed')
    .map((result) => `${result?.file ?? result?.suite ?? 'unknown'}${result?.line ? `:${result.line}` : ''} [${result?.ruleId ?? 'unknown'}] ${result?.message ?? result?.assertion ?? 'failed assertion'}`);
}

function main() {
  const policy = JSON.parse(readFileSync(path.join(repoRoot, '.kern', 'self-coverage-baseline.json'), 'utf8'));
  const configurationFailures = compareKernNativeCoverage({ total: 1, failed: 0, coverage: { percent: 100, total: Number.MAX_SAFE_INTEGER } }, policy)
    .filter((failure) => failure.startsWith('policy '));
  if (configurationFailures.length > 0) {
    console.error('KERN native coverage configuration failed:');
    for (const failure of configurationFailures) console.error(`- ${failure}`);
    process.exitCode = 1;
    return;
  }

  const selection = resolveKernCli(repoRoot);
  printResolution('kern:coverage', selection, selection.requiredVersion);
  prepareCandidate('kern:coverage', selection.candidate);
  const result = spawnSync(selection.candidate.command, [
    ...selection.candidate.commandArgs,
    'test', policy.root,
    '--coverage',
    '--min-coverage', String(policy.minimums.nativeCoveragePct),
    '--baseline', path.join(repoRoot, '.kern', 'kern-test-baseline.json'),
    '--json',
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });

  let summary;
  let parseFailure = '';
  if (!result.stdout?.trim()) {
    parseFailure = 'native test CLI returned empty output';
  } else {
    try {
      summary = JSON.parse(result.stdout);
    } catch (error) {
      parseFailure = `native test CLI returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  const failures = compareKernNativeCoverage(summary, policy);
  if (parseFailure) failures.push(parseFailure);
  if (result.error) failures.push(`native test CLI failed: ${result.error.message}`);
  else if (result.status !== 0 && !(summary?.failed > 0)) {
    failures.push(`native test CLI exited ${String(result.status)}${result.stderr?.trim() ? `: ${result.stderr.trim()}` : ''}`);
  }

  if (summary?.coverage) console.log(formatCoverage(summary, policy.root));
  for (const detail of formatFailedAssertions(summary)) console.error(`- ${detail}`);
  if (failures.length > 0) {
    console.error('KERN native coverage gate failed:');
    for (const failure of failures) console.error(`- ${failure}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) main();
