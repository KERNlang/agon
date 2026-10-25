import { profileFor } from './mutation-languages.js';
import { resolveWithinRoot } from './paths.js';
import type { Mutant } from './mutant-generator.js';

const FILE_PLACEHOLDER = '{file}';

export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function compileCheckTemplate(checks: Readonly<Record<string, string>> | undefined, file: string | undefined): string | undefined {
  if (!checks || !file) return undefined;
  const id = profileFor(file)?.id;
  const cmd = id ? checks[id] : undefined;
  return cmd?.trim() ? cmd : undefined;
}

export function expandCompileCheck(template: string, absFile: string): string {
  return template.split(FILE_PLACEHOLDER).join(shellQuote(absFile));
}

/**
 * The distinct commands a green baseline must pass before any mutant is graded: a template without `{file}` runs once as-is, one with `{file}` runs once per target file. `templates` lists the unexpanded checks in first-seen order for the report.
 */
export function baselineCompileChecks(worktree: string, mutants: readonly Mutant[], checks: Readonly<Record<string, string>> | undefined): { commands: string[]; templates: string[] } {
  const commands = new Set<string>();
  const templates = new Set<string>();
  for (const mutant of mutants) {
    const template = compileCheckTemplate(checks, mutant.file);
    if (!template || !mutant.file) continue;
    let abs: string;
    try { abs = resolveWithinRoot(worktree, mutant.file); } catch { continue; }
    templates.add(template);
    commands.add(template.includes(FILE_PLACEHOLDER) ? expandCompileCheck(template, abs) : template);
  }
  return { commands: [...commands], templates: [...templates] };
}
