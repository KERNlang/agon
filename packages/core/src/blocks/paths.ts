import { lstatSync, realpathSync } from 'node:fs';

import { resolve, sep, dirname, basename, join } from 'node:path';

/**
 * The canonical (symlink-resolved) form of `target`. A path that does not exist yet is canonicalized through its deepest EXISTING ancestor, with the missing segments appended — so a not-yet-created file still gets a truthful containment answer. Never throws.
 */
export function canonicalPath(target: string): string {
  const abs = resolve(target);
  let head = abs;
  const rest: string[] = [];
  for (let depth = 0; depth < 4096; depth += 1) {
    try {
      const real = realpathSync(head);
      return rest.length === 0 ? real : join(real, ...rest);
    } catch { /* head does not exist yet — step up and retry */ }
    const parent = dirname(head);
    if (parent === head) return abs;
    rest.unshift(basename(head));
    head = parent;
  }
  return abs;
}

/**
 * True when `candidate` canonically IS `root` or lives under it. Both sides are symlink-resolved first, so a link pointing out of the root answers false even though its lexical form looks contained. Pure-ish (stats the filesystem), never throws.
 */
export function isInsideRealpath(root: string, candidate: string): boolean {
  const base = canonicalPath(root);
  const abs = canonicalPath(candidate);
  if (abs === base) return true;
  return abs.startsWith(base + sep);
}

/**
 * Resolve candidate against root and THROW if it escapes: lexically (absolute paths, ../), through a symlinked final component, or through a symlinked parent whose real target is outside the root. Containment is ALWAYS decided on canonical paths — the lexical form is only a fast accept. Returns the resolved (non-canonical) path so callers keep the path the user sees.
 */
export function resolveWithinRoot(root: string, candidate: string): string {
  const base = resolve(root);
  const abs = resolve(base, candidate);
  // The lexical comparison is a FAST ACCEPT, never the verdict. The two sides
  // can be spelled through different links and still be the same place: on
  // macOS a caller that realpath'd its root holds `/private/tmp/x` while an
  // ABSOLUTE candidate the user (or mkdtemp) produced reads `/tmp/x/f.ts`.
  // That is the same directory, and rejecting it here made every absolute
  // target under /tmp "escape" its own root. So a lexical miss falls through
  // to the canonical arbiter (which resolves BOTH sides) instead of throwing.
  // Real escapes — `../outside`, a genuinely unrelated absolute path — fail
  // the canonical check too, so nothing is let through that was blocked before.
  if (abs !== base && !abs.startsWith(base + sep) && !isInsideRealpath(base, abs)) {
    throw new Error(`Path ${JSON.stringify(candidate)} escapes ${base}`);
  }
  let isLink = false;
  try { isLink = lstatSync(abs).isSymbolicLink(); } catch { isLink = false; }
  if (isLink) {
    throw new Error(`Path ${JSON.stringify(candidate)} is a symlink — refusing to write through it out of ${base}`);
  }
  if (!isInsideRealpath(base, abs)) {
    throw new Error(`Path ${JSON.stringify(candidate)} escapes ${base} through a symlinked parent directory`);
  }
  return abs;
}
