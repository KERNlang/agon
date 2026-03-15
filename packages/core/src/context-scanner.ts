import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { scanKernProject, projectToKern } from 'kern-lang/dist/context-export.js';

export type ContextFormat = 'plain' | 'kern';

const CONTEXT_FILES = [
  'package.json',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'pom.xml',
  'build.gradle',
  '.agon.json',
];

const README_PATTERNS = [
  'README.md',
  'readme.md',
  'README.txt',
  'README',
];

const MAX_README_CHARS = 2000;
const MAX_TREE_DEPTH = 3;
const MAX_TREE_ENTRIES = 60;

/**
 * Detect whether a directory is a Kern project.
 * Checks for: kern.config.ts, 'kern-lang' in package.json deps, .kern files.
 */
export function isKernProject(cwd: string): boolean {
  // kern.config.ts exists
  if (existsSync(join(cwd, 'kern.config.ts'))) return true;

  // kern-lang in package.json dependencies
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    const allDeps = {
      ...pkg.dependencies,
      ...pkg.devDependencies,
    };
    if ('kern-lang' in allDeps) return true;
  } catch { /* no package.json */ }

  // .kern files in cwd or cwd/src
  try {
    const hasKernFiles = readdirSync(cwd).some((f) => f.endsWith('.kern'));
    if (hasKernFiles) return true;
  } catch { /* skip */ }

  try {
    const srcDir = join(cwd, 'src');
    if (existsSync(srcDir)) {
      const hasKernSrc = readdirSync(srcDir).some((f) => f.endsWith('.kern'));
      if (hasKernSrc) return true;
    }
  } catch { /* skip */ }

  return false;
}

/**
 * Scan a project directory and build a context summary for engine prompts.
 * Reads package manifests, READMEs, and directory structure.
 *
 * @param format - 'plain' (default) or 'kern' for LLM-native structured format.
 *                 Auto-detects Kern projects when format is 'kern'.
 */
export function scanProjectContext(
  cwd: string,
  extraContext?: string,
  format?: ContextFormat,
): string {
  const effectiveFormat = format ?? 'plain';
  const isKern = isKernProject(cwd);

  if (effectiveFormat === 'kern' || isKern) {
    return scanKernContext(cwd, extraContext);
  }

  return scanPlainContext(cwd, extraContext);
}

// ── Plain text context (default) ────────────────────────────────────

function scanPlainContext(cwd: string, extraContext?: string): string {
  const sections: string[] = [];

  // Project manifest
  for (const file of CONTEXT_FILES) {
    const path = join(cwd, file);
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        if (file === 'package.json') {
          const pkg = JSON.parse(content);
          const deps = Object.keys(pkg.dependencies ?? {}).join(', ');
          const devDeps = Object.keys(pkg.devDependencies ?? {}).join(', ');
          sections.push(
            `Project: ${pkg.name ?? basename(cwd)} (${pkg.version ?? '?'})` +
            (pkg.description ? `\nDescription: ${pkg.description}` : '') +
            (deps ? `\nDependencies: ${deps}` : '') +
            (devDeps ? `\nDev dependencies: ${devDeps}` : ''),
          );
        } else {
          sections.push(`${file}:\n${content.slice(0, 1000)}`);
        }
      } catch { /* skip unreadable */ }
      break;
    }
  }

  // README excerpt
  for (const pattern of README_PATTERNS) {
    const path = join(cwd, pattern);
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        const excerpt = content.slice(0, MAX_README_CHARS);
        sections.push(`README:\n${excerpt}${content.length > MAX_README_CHARS ? '\n...(truncated)' : ''}`);
      } catch { /* skip */ }
      break;
    }
  }

  // Directory tree
  const tree = buildTree(cwd, 0);
  if (tree.length > 0) {
    sections.push(`Directory structure:\n${tree.join('\n')}`);
  }

  if (extraContext) {
    sections.push(`User context: ${extraContext}`);
  }

  return sections.join('\n\n');
}

// ── Kern-format context (powered by kern-lang) ─────────────────────

function scanKernContext(cwd: string, extraContext?: string): string {
  // Use kern-lang's real scanner + formatter
  const summary = scanKernProject(cwd);
  let output = projectToKern(summary);

  // Append plain context for non-Kern project info
  const plainExtra = scanPlainContext(cwd, extraContext);
  if (plainExtra) {
    output += '\n\n' + plainExtra;
  }

  return output;
}

// ── Helpers ─────────────────────────────────────────────────────────

function buildTree(dir: string, depth: number): string[] {
  if (depth >= MAX_TREE_DEPTH) return [];

  const lines: string[] = [];
  const indent = '  '.repeat(depth);

  try {
    const entries = readdirSync(dir)
      .filter((e) => !e.startsWith('.') && e !== 'node_modules' && e !== 'dist' && e !== 'build' && e !== '__pycache__' && e !== 'target' && e !== '.git')
      .sort();

    for (const entry of entries) {
      if (lines.length >= MAX_TREE_ENTRIES) {
        lines.push(`${indent}  ... (${entries.length - MAX_TREE_ENTRIES} more)`);
        break;
      }

      const path = join(dir, entry);
      try {
        const stat = statSync(path);
        if (stat.isDirectory()) {
          lines.push(`${indent}${entry}/`);
          lines.push(...buildTree(path, depth + 1));
        } else {
          lines.push(`${indent}${entry}`);
        }
      } catch { /* skip inaccessible */ }
    }
  } catch { /* skip unreadable dir */ }

  return lines;
}
