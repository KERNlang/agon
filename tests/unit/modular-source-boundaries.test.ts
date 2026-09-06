import { expect, it } from 'vitest';
import * as verifier from '../../scripts/spec/verify-modular-support-boundaries.mjs';

function inspect(source: string, filename = '/fixture/support/src/test.ts') {
  expect(verifier).toHaveProperty('inspectSourceImports');
  return verifier.inspectSourceImports(source, filename, '/fixture/support');
}

it.each([
  "import { x } from '@kernlang/agon-core';",
  "export * from '@kernlang/agon-forge/private.js';",
  "import('@kernlang/agon-cli');",
  "import(`@kernlang/agon-core/private.js`);",
  "require('@kernlang/agon-dedup');",
  "require.resolve('@kernlang/agon-core/private.js');",
  "type T = import('@kernlang/agon-core').Thing;",
  "import core = require('@kernlang/agon-core');",
])('rejects private imports in executable and type syntax: %s', source => {
  expect(inspect(source).some((error: string) => error.includes('private legacy import'))).toBe(true);
});

it.each(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'mts', 'cts'])('checks %s source', extension => {
  expect(inspect("import('@kernlang/agon-core')", `/fixture/support/src/test.${extension}`)).toHaveLength(1);
});

it('rejects relative escapes and absolute/file imports', () => {
  for (const source of ["import '../../core/private.js'", "import('/fixture/core/private.js')", "require('file:///fixture/core/private.js')"]) {
    expect(inspect(source).length).toBeGreaterThan(0);
  }
});

it('does not mistake comments or ordinary string contents for imports', () => {
  expect(inspect("// import '@kernlang/agon-core'\nconst example = \"require('@kernlang/agon-core')\";" )).toEqual([]);
});

it('permits public support imports and contained local imports', () => {
  expect(inspect("import { x } from '@kernlang/agon-support-panel'; export * from './local.js'; import('node:fs');")).toEqual([]);
});

it('does not pretend computed imports are statically verified', () => {
  expect(inspect('import(packageName)').some((error: string) => error.includes('computed module'))).toBe(true);
});

it('rejects syntax it cannot parse instead of silently skipping it', () => {
  expect(inspect("import { from 'broken").some((error: string) => error.includes('parse error'))).toBe(true);
});
