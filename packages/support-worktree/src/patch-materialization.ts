import { execFileSync, spawnSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { decodeGitPath } from './git-path.js';
import { parsePatch } from './patch-parser.js';

/** Resolve a patch path without following intermediate links. */
function containedPath(root: string, path: string): string {
  if (!path || isAbsolute(path) || path.includes('\0') || path.split('/').some(part => part === '..' || part === '.git')) {
    throw new Error('Copy patch contains an unsafe path');
  }
  const target = resolve(root, path);
  if (!target.startsWith(resolve(root) + sep)) throw new Error('Copy path escapes the workspace');
  let parent = dirname(target);
  while (parent !== resolve(root)) {
    try {
      if (!lstatSync(parent).isDirectory()) throw new Error('Copy path parent is not a directory');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    parent = dirname(parent);
  }
  return target;
}

/** Read bytes and mode without following a final regular-file replacement. */
function readSource(root: string, path: string): { symbolicLink: boolean; mode: number; bytes: Buffer } {
  const source = containedPath(root, path);
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) return { symbolicLink: true, mode: stat.mode & 0o777, bytes: readlinkSync(source, { encoding: 'buffer' }) };
  const descriptor = openSync(source, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const opened = fstatSync(descriptor);
    if (!opened.isFile()) throw new Error('Copy source is not a regular file or symbolic link');
    return { symbolicLink: false, mode: opened.mode & 0o777, bytes: readFileSync(descriptor) };
  } finally { closeSync(descriptor); }
}

/** Identify entries whose inverse needs workspace bytes. */
function needsMaterialization(block: string): boolean {
  return block.startsWith('diff --git ') && (/^copy from /m.test(block)
    || (/^GIT binary patch$/m.test(block) && (block.match(/^(?:literal|delta) [0-9]+$/gm)?.length ?? 0) < 2));
}

/** Complete context-dependent patch entries before mutation. */
export function preparePatchForUndo(cwd: string, content: string): { content: string; verifySources: () => void } {
  const blocks = content.split(/(?=^diff --git )/m);
  if (!blocks.some(needsMaterialization)) return { content, verifySources() {} };
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).replace(/\r?\n$/, '');
  // Git validates the complete original patch before we read any source bytes.
  execFileSync('git', ['apply', '--check', '-'], { cwd: root, input: content, stdio: ['pipe', 'pipe', 'pipe'] });
  const sources: Array<{ path: string; snapshot: ReturnType<typeof readSource> }> = [];
  const prepared = blocks.map(block => {
    if (!needsMaterialization(block)) return block;
    const destination = parsePatch(block)[0]?.path;
    if (!destination || destination === 'unknown') throw new Error('Patch has no resolved destination');
    const sourceHeader = block.match(/^(?:copy|rename) from (.+)$/m);
    const source = sourceHeader ? decodeGitPath(sourceHeader[1]) : destination;
    const creation = /^new file mode /m.test(block);
    const snapshot = creation ? null : readSource(root, source);
    if (snapshot) sources.push({ path: source, snapshot });
    containedPath(root, destination);
    const scratch = mkdtempSync(join(tmpdir(), 'agon-copy-patch-'));
    try {
      const scratchSource = containedPath(scratch, source);
      containedPath(scratch, destination);
      mkdirSync(dirname(scratchSource), { recursive: true });
      if (snapshot?.symbolicLink) {
        symlinkSync(snapshot.bytes, scratchSource);
      } else if (snapshot) {
        writeFileSync(scratchSource, snapshot.bytes, { mode: snapshot.mode });
      }
      // Do not inherit repository redirection, templates, filters, or diff drivers.
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
      env.GIT_CONFIG_NOSYSTEM = '1';
      env.GIT_CONFIG_GLOBAL = '/dev/null';
      const options = { cwd: scratch, env, encoding: 'utf8' as const, maxBuffer: 32 * 1024 * 1024 };
      execFileSync('git', ['init', '--quiet', '--template='], options);
      // Binary encoding preserves bytes that are not valid UTF-8 text.
      mkdirSync(join(scratch, '.git', 'info'), { recursive: true });
      writeFileSync(join(scratch, '.git', 'info', 'attributes'), '* -diff -text -filter -ident -working-tree-encoding\n');
      if (snapshot) execFileSync('git', ['add', '--force', '--', source], options);
      execFileSync('git', ['apply', '-'], { ...options, input: block });
      if (creation || source !== destination) execFileSync('git', ['add', '--intent-to-add', '--force', '--', destination], options);
      const addition = spawnSync('git', ['diff', '--exit-code', '--binary', '--no-renames', '--no-ext-diff', '--no-textconv'], options);
      if (addition.error || addition.status !== 1 || !addition.stdout) {
        throw new Error(`Cannot materialize patch: ${addition.error?.message ?? addition.stderr}`);
      }
      return addition.stdout;
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }).join('');
  return { content: prepared, verifySources() {
    for (const { path, snapshot } of sources) {
      const current = readSource(root, path);
      if (current.symbolicLink !== snapshot.symbolicLink || current.mode !== snapshot.mode || !current.bytes.equals(snapshot.bytes)) {
        throw new Error('Copy source changed during preparation; no patch applied');
      }
    }
  } };
}
