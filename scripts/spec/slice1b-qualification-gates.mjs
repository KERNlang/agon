import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isAbsolute, normalize, sep } from 'node:path';

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function git(root, args, encoding = 'utf8') {
  const result = spawnSync('git', args, { cwd: root, encoding, maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr?.toString() || `git ${args.join(' ')} failed`);
  return result.stdout;
}

function nulList(root, args) {
  return String(git(root, args)).split('\0').filter(Boolean).sort();
}

function safeRelativePath(path) {
  if (typeof path !== 'string' || path.length === 0 || isAbsolute(path)) return false;
  const normalized = normalize(path);
  return normalized !== '..' && !normalized.startsWith(`..${sep}`) && normalized === path;
}

function objectBytes(root, subject, path) {
  const object = subject.kind === 'index' ? `:${path}` : `${subject.revision ?? 'HEAD'}:${path}`;
  return git(root, ['show', object], null);
}

function subjectEntries(root, subject, pathspecs) {
  const output = subject.kind === 'index'
    ? String(git(root, ['ls-files', '--stage', '-z', '--', ...pathspecs]))
    : String(git(root, ['ls-tree', '-r', '-z', subject.revision ?? 'HEAD', '--', ...pathspecs]));
  return output.split('\0').filter(Boolean).map((entry) => {
    const tab = entry.indexOf('\t');
    if (tab < 0) throw new Error(`invalid Git object listing entry: ${entry}`);
    const metadata = entry.slice(0, tab).split(' ');
    const path = entry.slice(tab + 1);
    const [mode, objectTypeOrId, objectIdOrStage] = metadata;
    const objectId = subject.kind === 'index' ? objectTypeOrId : objectIdOrStage;
    if (!mode || !objectId || !path) throw new Error(`incomplete Git object listing entry: ${entry}`);
    return { mode, objectId, path };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

export function hashGitSubject(root, { kind, revision = 'HEAD', pathspecs, includePathsInHash = true, excludedPaths = [], excludedPathPrefixes = [], excludedPathSuffixes = [] }) {
  if (!['index', 'commit'].includes(kind)) throw new TypeError('subject kind must be index or commit');
  if (!Array.isArray(pathspecs) || pathspecs.length === 0) throw new TypeError('pathspecs must not be empty');
  const subject = { kind, revision };
  const entries = subjectEntries(root, subject, pathspecs).filter(({ path }) => !excludedPaths.includes(path) && !excludedPathPrefixes.some((prefix) => path.startsWith(prefix)) && !excludedPathSuffixes.some((suffix) => path.endsWith(suffix)));
  if (entries.length === 0) throw new Error('qualified subject contains no files');
  const digest = createHash('sha256');
  for (const { mode, objectId, path } of entries) {
    if (mode === '120000') throw new Error(`symbolic link is not allowed in qualified subject: ${path}`);
    if (includePathsInHash) {
      // Object IDs bind the exact staged/committed bytes without consulting
      // ambient worktree files. Mode and path are part of the subject too.
      digest.update(mode).update('\0').update(path).update('\0').update(objectId).update('\0');
    } else {
      // Review artifacts use portable SHA-256 over the exact Git object bytes.
      digest.update(objectBytes(root, subject, path));
    }
  }
  return `sha256:${digest.digest('hex')}`;
}

export function isSourceBearingPath(path, { nonSourcePaths = [] } = {}) {
  if (nonSourcePaths.includes(path)) return false;
  const parts = path.split('/');
  const name = parts.at(-1) ?? path;
  if (parts.some((part) => part === 'dist' || part === 'node_modules' || part.startsWith('dist-'))) return false;
  return !name.endsWith('.tsbuildinfo') && !name.endsWith('.orig');
}

export function collectSubjectContamination(root, pathspecs) {
  return {
    ignored: nulList(root, ['ls-files', '-z', '--others', '--ignored', '--exclude-standard', '--', ...pathspecs]),
    untracked: nulList(root, ['ls-files', '-z', '--others', '--exclude-standard', '--', ...pathspecs]),
    unstaged: nulList(root, ['diff', '--name-only', '-z', '--', ...pathspecs]),
  };
}

export function validateDependencyGraph(packages) {
  const seen = new Set();
  const duplicates = [];
  let declaredEdges = 0;
  for (const pkg of packages) {
    const packageEdges = new Set();
    for (const dependency of pkg.dependencies ?? []) {
      declaredEdges += 1;
      const edge = `${pkg.id}->${dependency}`;
      if (packageEdges.has(edge) || seen.has(edge)) duplicates.push(edge);
      packageEdges.add(edge);
      seen.add(edge);
    }
  }
  return { declaredEdges, uniqueEdges: seen.size, duplicateEdges: [...new Set(duplicates)].sort() };
}

export function validateSubjectBoundReview(root, review, expectedSubject) {
  const fail = (reason) => ({ passed: false, reason });
  if (!review || typeof review !== 'object' || review.schemaVersion !== 1) return fail('invalid review schema');
  if (review.subject?.kind !== expectedSubject.kind || review.subject?.hash !== expectedSubject.hash) return fail('review subject mismatch');
  if (review.disposition !== 'passed') return fail('review disposition is not passed');
  const runs = Array.isArray(review.runs) ? review.runs.filter((run) => run.status === 'completed') : [];
  if (runs.length < 2 || new Set(runs.map((run) => run.engine)).size !== runs.length) return fail('distinct completed review engines are required');
  const paths = new Set();
  for (const run of runs) {
    if (!Array.isArray(run.artifacts) || run.artifacts.length === 0) return fail('completed review run has no artifact');
    for (const artifact of run.artifacts) {
      if (!safeRelativePath(artifact.path)) return fail('review artifact path must be normalized and repository-relative');
      if (paths.has(artifact.path)) return fail('review artifacts must be distinct');
      paths.add(artifact.path);
      let actual;
      try {
        actual = hashGitSubject(root, { kind: expectedSubject.kind, revision: expectedSubject.revision, pathspecs: [artifact.path], includePathsInHash: false });
      } catch {
        return fail('review artifact is absent from the qualified Git subject');
      }
      if (artifact.hash !== actual) return fail('review artifact hash mismatch');
    }
  }
  if (!Array.isArray(review.findings)) return fail('review findings are missing');
  for (const finding of review.findings) {
    if (!['resolved', 'refuted', 'deferred'].includes(finding.status)) return fail('review has an open finding');
    if (finding.status === 'deferred' && finding.externalBlocker !== true) return fail('local finding cannot be deferred');
  }
  return { passed: true };
}

export function validateStoredSubjectBoundReview(root, reviewPath, expectedSubject) {
  if (!safeRelativePath(reviewPath)) return { passed: false, reason: 'review evidence path must be normalized and repository-relative' };
  let review;
  try {
    review = JSON.parse(String(objectBytes(root, expectedSubject, reviewPath)));
  } catch {
    return { passed: false, reason: 'review evidence is absent or invalid in the qualified Git subject' };
  }
  return validateSubjectBoundReview(root, review, expectedSubject);
}

export { sha256 };
