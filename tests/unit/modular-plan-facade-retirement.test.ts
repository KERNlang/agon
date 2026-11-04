import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';
import * as core from '@kernlang/agon-core';
import * as plan from '@kernlang/agon-mod-plan';

const root = fileURLToPath(new URL('../../', import.meta.url));
const retired = join(root, 'packages/core/src/cesar/plan.ts');

function importsRetired(path: string, source: string): string[] {
  return ts.preProcessFile(source, true, true).importedFiles.map(item => item.fileName)
    .filter(name => name.startsWith('.') && resolve(dirname(path), name).replace(/\.js$/, '.ts') === retired);
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

it('removes the private core Plan state/store facade', () => {
  expect(existsSync(retired)).toBe(false);
});

it('leaves no production source edge to the retired Plan facade', () => {
  const violations: string[] = [];
  for (const entry of readdirSync(join(root, 'packages'), { withFileTypes: true })) {
    const directory = join(root, 'packages', entry.name, 'src');
    if (!entry.isDirectory() || !existsSync(directory)) continue;
    for (const path of sourceFiles(directory)) {
      for (const name of importsRetired(path, readFileSync(path, 'utf8'))) violations.push(`${path}: ${name}`);
    }
  }
  expect(violations).toEqual([]);
});

it('rejects restored static, type-only, dynamic and re-export edges', () => {
  const path = join(root, 'packages/core/src/index.ts');
  for (const source of [
    "import { saveCesarPlan } from './cesar/plan.js';",
    "import type { CesarPlan } from './cesar/plan.js';",
    "export { saveCesarPlan } from './cesar/plan.js';",
    "const plan = import('./cesar/plan.js');",
  ]) expect(importsRetired(path, source)).toHaveLength(1);
  expect(importsRetired(path, "export { saveCesarPlan } from '@kernlang/agon-mod-plan';")).toEqual([]);
});

it('preserves public core state/store exports as the physical Plan functions', () => {
  for (const name of [
    'createCesarPlan', 'approveCesarPlan', 'advanceCesarStep', 'cancelCesarPlan', 'exitCesarPlan',
    'getCesarPlansDir', 'cesarPlanJsonPath', 'cesarPlanMarkdownPath',
    'saveCesarPlan', 'loadCesarPlan', 'listCesarPlans', 'CESAR_STEP_TYPES',
  ] as const) expect(core[name], name).toBe(plan[name]);
});
