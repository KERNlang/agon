import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createCesarToolRegistry } from '../../packages/cli/src/cesar/tools.js';
import { disposeProcessSurfaceAuthority, initializeProcessSurfaceAuthority } from '../../packages/cli/src/surface-authority-runtime.js';

const root = mkdtempSync(join(tmpdir(), 'agon-workflow-metadata-'));

beforeAll(() => initializeProcessSurfaceAuthority(join(root, 'host')));
afterAll(async () => {
  await disposeProcessSurfaceAuthority();
  rmSync(root, { recursive: true, force: true });
});

describe('workflow tool metadata', () => {
  it('exposes certified workflow metadata on the physical Pipeline mod tool', () => {
    const tool = createCesarToolRegistry('codex').get('Pipeline')!;
    expect(tool.definition.metadata?.workflow).toEqual({
      id: 'agon.build-review-fix',
      version: 'v1',
      alias: 'agon.build-review-fix@v1',
      phases: ['build', 'review', 'fix'],
      conformance: 'core-workflow-registry',
    });
  });
});
