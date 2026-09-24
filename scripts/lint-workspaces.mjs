import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';

export function partitionLintFiles(files) {
  if (new Set(files).size !== files.length) throw new Error('duplicate lint file');
  const groups = new Map();
  for (const file of [...files].sort()) {
    const parts = file.replaceAll('\\', '/').split('/');
    const key = parts[0] === 'packages' && parts.length > 2 ? parts.slice(0, 2).join('/') : 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(file);
  }
  return groups;
}

async function main() {
  if (process.argv[2] === '--files') {
    const files = JSON.parse(readFileSync(0, 'utf8'));
    const eslint = new ESLint();
    const results = await eslint.lintFiles(files);
    const formatter = await eslint.loadFormatter('stylish');
    const output = formatter.format(results);
    if (output) process.stdout.write(output);
    return results.some((result) => result.errorCount > 0 || result.warningCount > 0) ? 1 : 0;
  }
  // Ask ESLint itself for the exact `eslint .` file scope. This discovery pass
  // does not build TypeScript programs or count as validation. Every returned
  // file is subsequently linted with the unchanged config/rules in a child.
  const discovery = new ESLint({ ruleFilter: () => false,
    overrideConfig: { languageOptions: { parserOptions: { projectService: false, project: false } } } });
  const files = (await discovery.lintFiles(['.'])).map(({ filePath }) => relative(process.cwd(), filePath));
  if (!files.length) throw new Error('ESLint discovered no files');
  const partitions = partitionLintFiles(files);
  console.log(`Linting ${files.length} files in ${partitions.size} isolated partitions (zero warnings allowed).`);
  let failed = false;
  for (const [name, selected] of partitions) {
    console.log(`Lint ${name}: ${selected.length} files`);
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--files'], {
      input: JSON.stringify(selected), stdio: ['pipe', 'inherit', 'inherit'], env: process.env,
    });
    if (child.error || child.status !== 0) {
      failed = true;
      console.error(`Lint partition ${name} failed: ${child.error?.message ?? child.signal ?? child.status}`);
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(error); process.exitCode = 1; });
}
