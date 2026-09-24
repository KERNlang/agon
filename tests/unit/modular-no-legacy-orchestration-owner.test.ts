import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = resolve(import.meta.dirname, '../..');

describe('modular orchestration ownership guard', () => {
  it('keeps physical mods as the only orchestration-tool implementation owner', () => {
    expect(existsSync(resolve(root, 'packages/core/src/blocks/tool-orchestration.ts'))).toBe(false);

    const exports = [
      readFileSync(resolve(root, 'packages/core/src/tools.ts'), 'utf8'),
      readFileSync(resolve(root, 'packages/core/src/index.ts'), 'utf8'),
    ].join('\n');
    for (const creator of [
      'createForgeTool', 'createBrainstormTool', 'createTribunalTool', 'createCampfireTool',
      'createDelegateTool', 'createPipelineTool', 'createGoalTool', 'createConquerTool',
      'createReviewTool', 'createAgentTool', 'createQuickNeroTool',
    ]) {
      expect(exports, creator).not.toContain(creator);
    }

    const cesarRouter = readFileSync(resolve(root, 'packages/cli/src/signals/dispatch/cesar-router.ts'), 'utf8');
    expect(cesarRouter).toContain('executeProcessCesarRoute');
    expect(cesarRouter).not.toMatch(/from ['"]\.\.\/\.\.\/handlers\/(?:brainstorm|tribunal|campfire|team-forge|team-brainstorm|team-tribunal|council|pipeline)/);
    expect(cesarRouter).not.toMatch(/\bhandle(?:Forge|Brainstorm|Tribunal|Campfire|TeamForge|TeamBrainstorm|TeamTribunal|Council|Pipeline)\s*\(/);
  });

  it('keeps the physical browser mod as the only serve command owner', () => {
    expect(existsSync(resolve(root, 'packages/cli/src/commands/serve.ts'))).toBe(false);
  });

  it('keeps the physical rooms mod as the only room runtime owner', () => {
    for (const file of [
      'types.ts', 'leases.ts', 'presence.ts', 'store.ts', 'tail.ts', 'tasks.ts',
      'locks.ts', 'unread.ts', 'auto-policy.ts',
    ]) {
      expect(existsSync(resolve(root, 'packages/core/src/rooms', file)), file).toBe(false);
    }
    const coreExports = readFileSync(resolve(root, 'packages/core/src/index.ts'), 'utf8');
    expect(coreExports).not.toMatch(/\.\/rooms\//);
    expect(existsSync(resolve(root, 'packages/mod-rooms/src/implementation.ts'))).toBe(true);
  });
});
