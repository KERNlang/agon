import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = resolve(import.meta.dirname, '../..');
const temp = mkdtempSync(join(tmpdir(), 'agon-s4-api-compat-'));
const packages = [
  'engine-runtime', 'persistence', 'dedup', 'browser-bridge', 'saas-api',
  'engine-catalog', 'verification', 'panel', 'worktree', 'agent-runtime', 'judge',
];

const revisionN2 = packages.map((name, index) =>
  `import { SUPPORT_PACKAGE as descriptor${index} } from '@kernlang/agon-support-${name}';\nvoid descriptor${index};`
).join('\n');
const revisionN1 = `${revisionN2}
import { resolveIsolationMode } from '@kernlang/agon-support-engine-runtime';
import { EngineRegistry } from '@kernlang/agon-support-engine-catalog';
import { persistencePath } from '@kernlang/agon-support-persistence';
import { applyShadow } from '@kernlang/agon-support-verification';
import { createPlan } from '@kernlang/agon-support-worktree';
import { isApiBackedEngine } from '@kernlang/agon-support-panel';
import { parseForgeJudgment } from '@kernlang/agon-support-judge';
import { makeBudgetError } from '@kernlang/agon-support-agent-runtime';
import { resolveSidecarPython } from '@kernlang/agon-support-dedup';
import { detectLanguageFromPath } from '@kernlang/agon-support-browser-bridge';
void [resolveIsolationMode, EngineRegistry, persistencePath, applyShadow, createPlan,
  isApiBackedEngine, parseForgeJudgment, makeBudgetError, resolveSidecarPython,
  detectLanguageFromPath];
`;

try {
  mkdirSync(join(temp, 'node_modules', '@kernlang'), { recursive: true });
  for (const name of packages) {
    symlinkSync(join(root, 'packages', `support-${name}`), join(temp, 'node_modules', '@kernlang', `agon-support-${name}`), 'dir');
  }
  symlinkSync(join(root, 'packages/mod-kernel'), join(temp, 'node_modules', '@kernlang', 'agon-kernel'), 'dir');
  writeFileSync(join(temp, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  writeFileSync(join(temp, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      strict: true,
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      noEmit: true,
      skipLibCheck: false,
    },
    include: ['revision-*.ts'],
  }));
  writeFileSync(join(temp, 'revision-n-2.ts'), revisionN2);
  writeFileSync(join(temp, 'revision-n-1.ts'), revisionN1);
  execFileSync(join(root, 'node_modules/.bin/tsc'), ['-p', join(temp, 'tsconfig.json')], { cwd: temp, stdio: 'inherit' });

  for (const name of packages) {
    const module = await import(pathToFileURL(join(root, 'packages', `support-${name}`, 'dist/index.js')).href);
    if (module.SUPPORT_PACKAGE?.id !== `@kernlang/agon-support-${name}`) throw new Error(`${name}: runtime descriptor mismatch`);
    if (!Object.isFrozen(module.SUPPORT_PACKAGE)) throw new Error(`${name}: runtime descriptor is mutable`);
  }
  console.log(`compiled pre-release contract revisions N-2 and N-1 and loaded ${packages.length} current runtime descriptors`);
} finally {
  rmSync(temp, { recursive: true, force: true });
}
