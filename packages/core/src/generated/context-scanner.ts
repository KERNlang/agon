// @kern-source: context-scanner:1
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';

// @kern-source: context-scanner:2
import { join, basename } from 'node:path';

// @kern-source: context-scanner:3
import { currentBranch, gitStatusShort, gitChangedFiles, gitTruncatedDiff, recentCommits, repoRoot } from './git.js';

// @kern-source: context-scanner:5
export type ContextFormat = 'plain' | 'kern';

// @kern-source: context-scanner:7
export function isKernProject(cwd: string): boolean {
  if (existsSync(join(cwd, 'kern.config.ts'))) return true;
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    if ('kern-lang' in { ...pkg.dependencies, ...pkg.devDependencies }) return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[agon] failed to read package.json in ${cwd}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  try {
    if (readdirSync(cwd).some((f: string) => f.endsWith('.kern'))) return true;
  } catch (err) {
    console.warn(`[agon] failed to scan directory ${cwd}: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    const srcDir = join(cwd, 'src');
    if (existsSync(srcDir) && readdirSync(srcDir).some((f: string) => f.endsWith('.kern'))) return true;
  } catch (err) {
    console.warn(`[agon] failed to scan src directory in ${cwd}: ${err instanceof Error ? err.message : String(err)}`);
  }
  return false;
}

// @kern-source: context-scanner:32
function buildFileTree(cwd: string, maxDepth?: number): string {
  const IGNORE = new Set(['node_modules', '.git', 'dist', '.next', '.cache', '.turbo', '__pycache__', '.venv', 'coverage']);
  const depth = maxDepth ?? 2;
  const lines: string[] = [];
  
  function walk(dir: string, prefix: string, level: number): void {
    if (level > depth) return;
    try {
      const entries = readdirSync(dir).filter((e: string) => !IGNORE.has(e) && !e.startsWith('.DS_'));
      entries.sort();
      for (const entry of entries) {
        const fullPath = join(dir, entry);
        try {
          const stat = statSync(fullPath);
          if (stat.isDirectory()) {
            lines.push(`${prefix}${entry}/`);
            if (level < depth) walk(fullPath, prefix + '  ', level + 1);
          } else {
            lines.push(`${prefix}${entry}`);
          }
        } catch (err) {
          console.warn(`[agon] failed to stat ${fullPath}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      console.warn(`[agon] failed to read directory ${dir}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  
  walk(cwd, '', 0);
  return lines.join('\n');
}

// @kern-source: context-scanner:67
function detectProjectType(cwd: string): string {
  const markers: string[] = [];
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    markers.push(`node (${pkg.name ?? 'unnamed'})`);
    if (pkg.scripts?.test) markers.push(`test: ${pkg.scripts.test}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[agon] failed to read package.json for project type detection: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (existsSync(join(cwd, 'kern.config.ts'))) markers.push('kern');
  if (existsSync(join(cwd, 'tsconfig.json'))) markers.push('typescript');
  if (existsSync(join(cwd, 'pyproject.toml'))) markers.push('python');
  if (existsSync(join(cwd, 'Cargo.toml'))) markers.push('rust');
  if (existsSync(join(cwd, 'go.mod'))) markers.push('go');
  return markers.join(', ') || 'unknown';
}

// @kern-source: context-scanner:87
export function scanProjectContext(cwd: string, extraContext?: string, format?: ContextFormat): string {
  const MAX_CHARS = 4000;
  const sections: string[] = [];
  
  // Branch + status
  let branch = 'unknown';
  try { branch = currentBranch(cwd); } catch (err) {
    console.warn(`[agon] failed to detect branch: ${err instanceof Error ? err.message : String(err)}`);
  }
  
  const status = gitStatusShort(cwd);
  const changed = gitChangedFiles(cwd);
  const projectType = detectProjectType(cwd);
  const isKern = isKernProject(cwd);
  
  // Header
  sections.push(`Project: ${basename(cwd)} (${projectType}${isKern ? ', KERN' : ''})`);
  sections.push(`Branch: ${branch}`);
  
  if (changed.length > 0) {
    sections.push(`Changed files (${changed.length}): ${changed.slice(0, 10).join(', ')}${changed.length > 10 ? ` (+${changed.length - 10} more)` : ''}`);
  }
  
  // Recent commits (compact)
  let commits = '';
  try { commits = recentCommits(cwd, 5); } catch (err) {
    console.warn(`[agon] failed to read recent commits: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (commits) {
    sections.push(`Recent commits:\n${commits}`);
  }
  
  // File tree (compact)
  const tree = buildFileTree(cwd, 1);
  if (tree) {
    sections.push(`File tree:\n${tree}`);
  }
  
  // Diff excerpt (if dirty)
  if (status) {
    const diff = gitTruncatedDiff(cwd, 100);
    if (diff) {
      sections.push(`Diff excerpt:\n${diff}`);
    }
  }
  
  // Extra context from user
  if (extraContext) {
    sections.push(`Additional context:\n${extraContext}`);
  }
  
  let result: string;
  if (format === 'kern') {
    result = sections.map((s) => `context {\n  ${s.replace(/\n/g, '\n  ')}\n}`).join('\n');
  } else {
    result = sections.join('\n\n');
  }
  
  // Cap at MAX_CHARS
  if (result.length > MAX_CHARS) {
    result = result.slice(0, MAX_CHARS - 20) + '\n... (truncated)';
  }
  
  return result;
}

