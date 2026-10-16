import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, sep } from 'node:path';

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

function git(root, args, encoding = 'utf8', input) {
  const result = spawnSync('git', args, { cwd: root, encoding, input, maxBuffer: 64 * 1024 * 1024 });
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
  const object = subject.tree ? `${subject.tree}:${path}` : subject.kind === 'index' ? `:${path}` : `${subject.revision ?? 'HEAD'}:${path}`;
  return git(root, ['show', object], null);
}

function subjectEntries(root, subject, pathspecs) {
  const liveIndex = subject.kind === 'index' && !subject.tree;
  const raw = liveIndex
    ? git(root, ['ls-files', '--stage', '-z', '--', ...pathspecs], null)
    : git(root, ['ls-tree', '-r', '-z', subject.tree ?? subject.revision ?? 'HEAD', '--', ...pathspecs], null);
  const output = raw.toString('utf8');
  if (!Buffer.from(output, 'utf8').equals(raw)) throw new Error('Git paths must be valid UTF-8');
  return output.split('\0').filter(Boolean).map((entry) => {
    const tab = entry.indexOf('\t');
    if (tab < 0) throw new Error(`invalid Git object listing entry: ${entry}`);
    const metadata = entry.slice(0, tab).split(' ');
    const path = entry.slice(tab + 1);
    const [mode, objectTypeOrId, objectIdOrStage] = metadata;
    const objectId = liveIndex ? objectTypeOrId : objectIdOrStage;
    if (!mode || !objectId || !path) throw new Error(`incomplete Git object listing entry: ${entry}`);
    return { mode, objectId, path };
  }).sort((left, right) => Buffer.compare(Buffer.from(left.path), Buffer.from(right.path)));
}

export function hashGitSubject(root, { kind, revision = 'HEAD', tree, pathspecs, includePathsInHash = true, excludedPaths = [], excludedPathPrefixes = [], excludedPathSuffixes = [] }) {
  if (!['index', 'commit'].includes(kind)) throw new TypeError('subject kind must be index or commit');
  if (!Array.isArray(pathspecs) || pathspecs.length === 0) throw new TypeError('pathspecs must not be empty');
  const subject = { kind, revision, tree };
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

export function pinGitSubject(root, kind, revision = 'HEAD') {
  if (!['index', 'commit'].includes(kind)) throw new TypeError('subject kind must be index or commit');
  const commit = String(git(root, ['rev-parse', '--verify', `${revision}^{commit}`])).trim();
  const tree = String(git(root, kind === 'index' ? ['write-tree'] : ['rev-parse', `${commit}^{tree}`])).trim();
  return Object.freeze({ kind, revision: commit, tree });
}

export const REVIEW_INPUT_POLICY = 'modular-review-input-v2';
export const REVIEW_SLICE_IDS = Object.freeze(['S1B', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9']);
const reviewManifestPath = id => `docs/specs/evidence/modular-agon-slice${id.slice(1).toLowerCase()}-review-evidence.json`;
const reviewEnvelopePaths = REVIEW_SLICE_IDS.flatMap(id => [
  reviewManifestPath(id),
  `docs/specs/evidence/receipts/modular-agon-${id.toLowerCase()}.json`,
]);

/** Exclude review envelopes, not source or reviewer artifacts. */
export function hashReviewSubject(root, { kind, revision, tree }, sliceId) {
  if (!REVIEW_SLICE_IDS.includes(sliceId)) throw new TypeError('unknown review slice');
  const name = `slice${sliceId.slice(1).toLowerCase()}`;
  const hash = hashGitSubject(root, {
    kind, revision, tree, pathspecs: ['.'],
    excludedPaths: [...reviewEnvelopePaths, `docs/specs/evidence/modular-agon-${name}-verification-receipt.json`],
    // Preserve the existing S4–S9 log exclusions. Aggregate hashing binds them.
    excludedPathPrefixes: ['S4', 'S5', 'S6', 'S7', 'S8', 'S9'].includes(sliceId)
      ? [`docs/specs/evidence/verification-logs/${name}/`] : [],
  });
  return sha256(`${REVIEW_INPUT_POLICY}\0${sliceId}\0${hash}`);
}

export function validateSliceReview(root, sliceId, subject) {
  const hash = hashReviewSubject(root, subject, sliceId);
  return validateStoredSubjectBoundReview(root, reviewManifestPath(sliceId), {
    ...subject, hash, policy: REVIEW_INPUT_POLICY,
  });
}

function subjectBlobs(root, subject) {
  if (!/^[a-f0-9]{40,64}$/.test(subject.tree ?? '')) throw new Error('materialization requires a pinned Git tree');
  const entries = subjectEntries(root, subject, ['.']);
  for (const entry of entries) {
    if (!['100644', '100755'].includes(entry.mode) || !safeRelativePath(entry.path)
        || entry.path.split('/').some(part => part.toLowerCase() === '.git')) {
      throw new Error(`unsupported qualification entry: ${entry.path}`);
    }
  }
  const data = git(root, ['cat-file', '--batch'], null, entries.map(entry => entry.objectId).join('\n') + '\n');
  let offset = 0;
  const blobs = entries.map(entry => {
    const end = data.indexOf(10, offset);
    const [objectId, type, sizeText] = data.subarray(offset, end).toString('utf8').split(' ');
    const size = Number(sizeText);
    if (end < offset || objectId !== entry.objectId || type !== 'blob' || !Number.isSafeInteger(size) || size < 0) throw new Error('invalid Git blob response');
    offset = end + 1;
    const bytes = data.subarray(offset, offset + size);
    if (bytes.length !== size || data[offset + size] !== 10) throw new Error('truncated Git blob response');
    offset += size + 1;
    return { ...entry, bytes };
  });
  if (offset !== data.length) throw new Error('unexpected trailing Git blob response');
  return blobs;
}

export function verifyMaterializedGitSubject(root, checkout, subject) {
  const blobs = subjectBlobs(root, subject);
  const expected = new Set(blobs.map(entry => entry.path));
  const directories = new Set();
  for (const { path } of blobs) {
    for (let directory = dirname(path); directory !== '.'; directory = dirname(directory)) directories.add(directory);
  }
  const walk = (relative = '') => {
    for (const name of readdirSync(join(checkout, relative))) {
      const path = relative ? `${relative}/${name}` : name;
      const stat = lstatSync(join(checkout, path));
      if (!relative && name === '.git') {
        if (!stat.isDirectory()) throw new Error('qualification Git directory must not be a link or file');
        continue;
      }
      if (stat.isDirectory()) {
        if (!directories.has(path)) throw new Error(`unexpected qualification entry: ${path}`);
        walk(path);
      }
      else if (!stat.isFile() || !expected.has(path)) throw new Error(`unexpected qualification entry: ${path}`);
    }
  };
  walk();
  for (const { path, mode, bytes } of blobs) {
    const file = join(checkout, path);
    const stat = lstatSync(file);
    if (!stat.isFile() || ((stat.mode & 0o111) !== 0) !== (mode === '100755') || !readFileSync(file).equals(bytes)) {
      throw new Error(`qualification bytes or mode differ: ${path}`);
    }
  }
  return { tree: subject.tree, files: blobs.length };
}

export function materializeGitSubject(root, checkout, subject) {
  if (!lstatSync(checkout).isDirectory() || readdirSync(checkout).some(name => name !== '.git')) {
    throw new Error('qualification destination must be an empty directory');
  }
  if (readdirSync(checkout).includes('.git') && !lstatSync(join(checkout, '.git')).isDirectory()) {
    throw new Error('qualification Git directory must not be a link or file');
  }
  for (const { path, mode, bytes } of subjectBlobs(root, subject)) {
    const destination = join(checkout, path);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, bytes, { flag: 'wx' });
    chmodSync(destination, mode === '100755' ? 0o755 : 0o644);
  }
  return verifyMaterializedGitSubject(root, checkout, subject);
}

export function initializeMaterializedGitSubject(root, checkout, subject) {
  verifyMaterializedGitSubject(root, checkout, subject);
  const format = String(git(root, ['rev-parse', '--show-object-format'])).trim();
  git(checkout, ['init', '--quiet', `--object-format=${format}`]);
  const entries = subjectEntries(root, subject, ['.']);
  const objects = String(git(checkout, ['hash-object', '-w', '--no-filters', '--stdin-paths'], 'utf8',
    entries.map(entry => JSON.stringify(entry.path)).join('\n') + '\n')).trim().split('\n');
  if (objects.length !== entries.length || entries.some((entry, index) => entry.objectId !== objects[index])) {
    throw new Error('qualification object import differs from pinned blobs');
  }
  git(checkout, ['read-tree', '--empty']);
  git(checkout, ['update-index', '-z', '--index-info'], 'utf8',
    entries.map(entry => `${entry.mode} ${entry.objectId}\t${entry.path}\0`).join(''));
  if (String(git(checkout, ['write-tree'])).trim() !== subject.tree) throw new Error('qualification index differs from pinned tree');
  git(checkout, ['-c', 'user.name=Agon Qualification', '-c', 'user.email=qualification',
    'commit', '--quiet', '--allow-empty', '-m', 'qualification subject']);
  if (String(git(checkout, ['rev-parse', 'HEAD^{tree}'])).trim() !== subject.tree) throw new Error('qualification commit differs from pinned tree');
  return verifyMaterializedGitSubject(root, checkout, subject);
}

export function isSourceBearingPath(path, { nonSourcePaths = [] } = {}) {
  if (nonSourcePaths.includes(path)) return false;
  const parts = path.split('/');
  const name = parts.at(-1) ?? path;
  if (/^(?:node_modules\/|packages\/[^/]+\/(?:node_modules|dist|dist-tsc)\/)/.test(path)) return false;
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
  if (expectedSubject.policy !== undefined && review.subject?.policy !== expectedSubject.policy) return fail('review input policy mismatch');
  if (review.subject?.kind !== expectedSubject.kind || review.subject?.hash !== expectedSubject.hash) return fail('review subject mismatch');
  if (review.disposition !== 'passed') return fail('review disposition is not passed');
  const runs = Array.isArray(review.runs) ? review.runs.filter((run) => run.status === 'completed') : [];
  if (runs.some((run) => typeof run.engine !== 'string' || run.engine.length === 0 || run.engine.trim() !== run.engine)) {
    return fail('review engine identifiers must be nonempty trimmed strings');
  }
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
        const entries = subjectEntries(root, expectedSubject, [`:(literal)${artifact.path}`]);
        if (entries.length !== 1 || entries[0].path !== artifact.path || !['100644', '100755'].includes(entries[0].mode)) {
          return fail('review artifact must name one exact regular Git file');
        }
        actual = sha256(git(root, ['cat-file', 'blob', entries[0].objectId], null));
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
