import { describe, expect, it } from 'vitest';
// @ts-expect-error untyped release script
import { orderForPublish, readWorkspaces } from '../../scripts/release/release-plan.mjs';

type Workspace = { directory: string; manifest: { name: string; private?: boolean; dependencies?: Record<string, string> } };
const workspace = (name: string, dependencies: string[] = [], isPrivate = false): Workspace => ({
  directory: name,
  manifest: { name, private: isPrivate, dependencies: Object.fromEntries(dependencies.map((dep) => [dep, '1.0.0'])) },
});

describe('release publish order', () => {
  it('publishes the launcher last so a half-failed release never moves latest onto an uninstallable graph', () => {
    const names = (orderForPublish(readWorkspaces()) as Workspace[]).map(({ manifest }) => manifest.name);
    expect(names).toHaveLength(50);
    expect(names.at(-1)).toBe('@kernlang/agon');
    expect(names.indexOf('@kernlang/agon-mod-api')).toBeLessThan(names.indexOf('@kernlang/agon-kernel'));
    expect(names).not.toContain('@kernlang/agon-core');
  });

  it('refuses a published package that depends on a private one, which caused the E404 install', () => {
    const graph = [workspace('@kernlang/agon', ['@kernlang/agon-kernel']), workspace('@kernlang/agon-kernel', [], true)];
    expect(() => orderForPublish(graph)).toThrow(/could never resolve/);
  });
});
