import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative } from 'node:path';

export const SLICE1A_PATHSPECS = Object.freeze([
  '.gitignore', 'package.json', 'package-lock.json', 'tsconfig.json', 'packages/mod-api', 'packages/mod-kernel', 'scripts/spec',
  'docs/specs', 'tests/spec', 'tests/helpers/modular-agon.ts', ':(glob)tests/unit/modular-*',
]);

export const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

function prefixWithinBytes(value, maxBytes) {
  let low = 0; let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(0, middle)) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return value.slice(0, low);
}

function suffixWithinBytes(value, maxBytes) {
  let low = 0; let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (Buffer.byteLength(value.slice(value.length - middle)) <= maxBytes) low = middle;
    else high = middle - 1;
  }
  return value.slice(value.length - low);
}

export function boundEvidenceOutput(output, maxBytes = 2 * 1024 * 1024) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 512) throw new TypeError('maxBytes must be a safe integer of at least 512');
  const originalBytes = Buffer.byteLength(output);
  const originalHash = sha256(output);
  if (originalBytes <= maxBytes) return { text: output, truncated: false, originalBytes, originalHash };
  const marker = `\n\n--- OUTPUT TRUNCATED: originalBytes=${originalBytes} originalHash=${originalHash} ---\n\n`;
  const markerBytes = Buffer.byteLength(marker);
  if (markerBytes >= maxBytes) throw new RangeError('maxBytes is too small for truncation metadata');
  const contentBudget = maxBytes - markerBytes;
  const headBudget = Math.floor(contentBudget / 2);
  const tailBudget = contentBudget - headBudget;
  return {
    text: `${prefixWithinBytes(output, headBudget)}${marker}${suffixWithinBytes(output, tailBudget)}`,
    truncated: true, originalBytes, originalHash,
  };
}


export function findUntrackedSubjectFiles(root) {
  const result = spawnSync('git', ['ls-files', '--others', '--exclude-standard', '--', ...SLICE1A_PATHSPECS], {
    cwd: root, encoding: 'utf8',
  });
  if (result.status !== 0 || result.error) throw result.error ?? new Error(result.stderr || 'git ls-files failed');
  return (result.stdout ?? '').trim().split('\n').filter(Boolean);
}

const EXCLUDED_SUBJECT_NAMES = new Set([
  'dist', 'node_modules', 'verification-logs',
  'modular-agon-slice1a-verification-receipt.json',
  'modular-agon-slice1a-review-evidence.json',
  'modular-agon-slice1a-performance.json',
]);

function subjectFiles(path) {
  return readdirSync(path).flatMap((name) => {
    if (EXCLUDED_SUBJECT_NAMES.has(name) || name.endsWith('.tsbuildinfo') || name.endsWith('.orig')) return [];
    const absolute = join(path, name);
    const metadata = lstatSync(absolute);
    if (metadata.isSymbolicLink()) throw new Error(`symbolic link is not allowed in Slice 1A subject: ${absolute}`);
    return metadata.isDirectory() ? subjectFiles(absolute) : [absolute];
  });
}

export function computeSubjectHash(root) {
  const files = [
    join(root, '.gitignore'), join(root, 'package.json'), join(root, 'package-lock.json'), join(root, 'tsconfig.json'),
    ...subjectFiles(join(root, 'packages/mod-api')),
    ...subjectFiles(join(root, 'packages/mod-kernel')),
    ...subjectFiles(join(root, 'scripts/spec')),
    ...subjectFiles(join(root, 'docs/specs')),
    ...subjectFiles(join(root, 'tests/spec')),
    join(root, 'tests/helpers/modular-agon.ts'),
    ...readdirSync(join(root, 'tests/unit')).filter((name) => name.startsWith('modular-') && !name.endsWith('.tsbuildinfo') && !name.endsWith('.orig')).map((name) => join(root, 'tests/unit', name)),
  ].sort();
  return sha256(files.map((file) => `${relative(root, file)}\0${readFileSync(file)}`).join('\0'));
}

export function validateReviewEvidence(review, subjectHash) {
  if (!review || typeof review !== 'object' || review.schemaVersion !== 1) return { passed: false, reason: 'invalid schema version' };
  if (review.subjectHash !== subjectHash) return { passed: false, reason: 'review subject hash mismatch' };
  if (review.disposition !== 'passed') return { passed: false, reason: 'review disposition is not passed' };
  const completedRuns = Array.isArray(review.runs) ? review.runs.filter(({ status }) => status === 'completed') : [];
  if (completedRuns.length < 2 || new Set(completedRuns.map(({ engine }) => engine)).size < 2) return { passed: false, reason: 'at least two distinct completed independent runs are required' };
  const artifactPaths = new Set();
  for (const run of completedRuns) {
    if (!Array.isArray(run.artifacts) || run.artifacts.length === 0) return { passed: false, reason: 'completed run has no artifacts' };
    for (const artifact of run.artifacts) {
      if (typeof artifact.path !== 'string' || typeof artifact.hash !== 'string' || !existsSync(artifact.path)) return { passed: false, reason: 'review artifact is missing' };
      let metadata;
      try { metadata = statSync(artifact.path); } catch { return { passed: false, reason: 'review artifact stat failed' }; }
      if (!metadata.isFile() || metadata.size === 0) return { passed: false, reason: 'review artifact is empty or not a file' };
      if (artifactPaths.has(artifact.path)) return { passed: false, reason: 'independent runs must use distinct artifacts' };
      artifactPaths.add(artifact.path);
      if (sha256(readFileSync(artifact.path)) !== artifact.hash) return { passed: false, reason: 'review artifact hash mismatch' };
    }
  }
  if (!Array.isArray(review.findings)) return { passed: false, reason: 'review findings are missing' };
  for (const finding of review.findings) {
    if (!['resolved', 'refuted', 'deferred'].includes(finding.status)) return { passed: false, reason: 'review has an open finding' };
    if (finding.status === 'deferred' && finding.externalBlocker !== true) return { passed: false, reason: 'local finding cannot be deferred' };
  }
  return { passed: true };
}
