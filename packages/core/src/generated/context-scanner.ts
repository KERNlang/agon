import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';

import { join, basename } from 'node:path';

export type ContextFormat = 'plain' | 'kern';

export function isKernProject(cwd: string): boolean {
  if (existsSync(join(cwd, 'kern.config.ts'))) return true;
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf-8'));
    if ('kern-lang' in { ...pkg.dependencies, ...pkg.devDependencies }) return true;
  } catch {}
  try {
    if (readdirSync(cwd).some((f: string) => f.endsWith('.kern'))) return true;
  } catch {}
  try {
    const srcDir = join(cwd, 'src');
    if (existsSync(srcDir) && readdirSync(srcDir).some((f: string) => f.endsWith('.kern'))) return true;
  } catch {}
  return false;
  
}

export function scanProjectContext(cwd: string, extraContext?: string, format?: ContextFormat): string {
  return '(context scanning not available from generated code)';
  
}

