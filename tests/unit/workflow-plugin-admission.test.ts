import { describe, expect, it } from 'vitest';

import {
  admitWorkflowPlugin,
  validateWorkflowPluginAdmission,
} from '../../packages/core/src/generated/workflows/plugins.js';

describe('workflow plugin admission', () => {
  it('admits read-only plugins with unclaimed aliases', () => {
    const result = validateWorkflowPluginAdmission({
      id: 'audit-plugin',
      trustedAdapter: true,
      aliases: ['audit'],
      phases: [{ id: 'audit' }],
    }, { existingAliases: ['core'] });

    expect(result).toEqual({ accepted: true, issues: [] });
  });

  it('accepts source trusted-adapter as trust evidence', () => {
    const result = validateWorkflowPluginAdmission({
      id: 'source-trusted',
      source: 'trusted-adapter',
      phases: [{ id: 'audit' }],
    });

    expect(result).toEqual({ accepted: true, issues: [] });
  });

  it('rejects reserved aliases, duplicate plugin ids, and mutation privileges by default', () => {
    const result = validateWorkflowPluginAdmission({
      id: 'mutator',
      trustedAdapter: true,
      aliases: ['run'],
      phases: [{ id: 'write', mutation: 'workspace' }],
    }, { existingPluginIds: ['mutator'] });

    expect(result.accepted).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['plugin-denied', 'reserved-alias', 'mutation-denied']),
    );
    expect(() => admitWorkflowPlugin({
      id: 'mutator',
      trustedAdapter: true,
      phases: [{ id: 'write', mutation: 'workspace' }],
    })).toThrowError(/admission rejected/);
  });

  it('rejects malformed plugin phase and capability definitions even when mutation is allowed', () => {
    const result = validateWorkflowPluginAdmission({
      id: 'malformed',
      trustedAdapter: true,
      capabilities: [{ id: 'patch-write', mutations: ['none'] }],
      phases: [
        { id: 'patch', requires: ['missing'], mutation: 'filesystem' as never },
        { id: 'patch', dependsOn: ['unknown'] },
      ],
      mutationPolicy: { allow: true, maxLevel: 'workspace', capabilities: ['missing'] },
    }, { allowMutations: true });

    expect(result.accepted).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['unknown-capability', 'invalid-phase', 'duplicate-id', 'missing-node']),
    );
  });

  it('rejects untrusted plugin adapters', () => {
    const result = validateWorkflowPluginAdmission({
      id: 'untrusted',
      source: 'untrusted',
      phases: [{ id: 'inspect' }],
    });

    expect(result.accepted).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('plugin-denied');
  });
});
