import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

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

// ── Kern-format context (LLM-native structured) ────────────────────

function scanKernContext(cwd: string, extraContext?: string): string {
  const lines: string[] = [];

  // Read package.json for project metadata
  let projectName = basename(cwd);
  let version = '?';
  let description = '';
  let deps: string[] = [];
  let devDeps: string[] = [];

  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    projectName = pkg.name ?? projectName;
    version = pkg.version ?? version;
    description = pkg.description ?? '';
    deps = Object.keys(pkg.dependencies ?? {});
    devDeps = Object.keys(pkg.devDependencies ?? {});
  } catch { /* no package.json */ }

  lines.push(`project ${projectName} {`);
  lines.push(`  version: "${version}"`);
  if (description) lines.push(`  description: "${description}"`);

  // Stack detection
  const stack: string[] = [];
  if (deps.includes('typescript') || devDeps.includes('typescript')) stack.push('TypeScript');
  if (deps.includes('react') || deps.includes('react-dom')) stack.push('React');
  if (deps.includes('next')) stack.push('Next.js');
  if (deps.includes('express')) stack.push('Express');
  if (deps.includes('prisma') || deps.includes('@prisma/client')) stack.push('Prisma');
  if (deps.includes('tailwindcss') || devDeps.includes('tailwindcss')) stack.push('Tailwind');
  if (deps.includes('vue')) stack.push('Vue');
  if (deps.includes('svelte')) stack.push('Svelte');
  if (stack.length > 0) lines.push(`  stack: ${stack.join(', ')}`);

  // Test runner
  if (devDeps.includes('vitest')) lines.push('  test: vitest');
  else if (devDeps.includes('jest')) lines.push('  test: jest');
  else if (devDeps.includes('mocha')) lines.push('  test: mocha');

  // Kern-specific context
  if (isKernProject(cwd)) {
    lines.push('');
    lines.push('  kern {');

    // Read kern.config.ts if it exists
    const configPath = join(cwd, 'kern.config.ts');
    if (existsSync(configPath)) {
      try {
        const configContent = readFileSync(configPath, 'utf-8');
        // Extract target from config
        const targetMatch = /target:\s*['"](\w+)['"]/.exec(configContent);
        if (targetMatch) lines.push(`    target: "${targetMatch[1]}"`);
      } catch { /* skip */ }
    }

    // Find .kern files
    const kernFiles = findFiles(cwd, '.kern', 2);
    if (kernFiles.length > 0) {
      lines.push(`    files: ${kernFiles.length}`);
      for (const f of kernFiles.slice(0, 10)) {
        lines.push(`    - ${f}`);
      }
    }

    lines.push('  }');
  }

  // Key directories as modules
  const tree = buildTree(cwd, 0);
  if (tree.length > 0) {
    lines.push('');
    lines.push('  structure {');
    for (const t of tree.slice(0, 30)) {
      lines.push(`    ${t}`);
    }
    if (tree.length > 30) lines.push(`    ... (${tree.length - 30} more)`);
    lines.push('  }');
  }

  // Dependencies
  if (deps.length > 0) {
    lines.push('');
    lines.push(`  dependencies: ${deps.join(', ')}`);
  }

  // Extra context
  if (extraContext) {
    lines.push('');
    lines.push(`  context: "${extraContext}"`);
  }

  lines.push('}');
  return lines.join('\n');
}

// ── Helpers ─────────────────────────────────────────────────────────

function findFiles(dir: string, ext: string, maxDepth: number, depth: number = 0): string[] {
  if (depth >= maxDepth) return [];
  const results: string[] = [];

  try {
    for (const entry of readdirSync(dir)) {
      if (entry.startsWith('.') || entry === 'node_modules' || entry === 'dist') continue;
      const path = join(dir, entry);
      try {
        const stat = statSync(path);
        if (stat.isFile() && entry.endsWith(ext)) {
          results.push(path.replace(dir + '/', ''));
        } else if (stat.isDirectory()) {
          results.push(
            ...findFiles(path, ext, maxDepth, depth + 1).map((f) => `${entry}/${f}`),
          );
        }
      } catch { /* skip */ }
    }
  } catch { /* skip */ }

  return results;
}

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
