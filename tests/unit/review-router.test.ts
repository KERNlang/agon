import { describe, expect, it } from 'vitest';

import type { EngineDefinition } from '@kernlang/agon-core';
import {
  inferReviewRisk,
  routeReviewers,
  serializeReviewRoutingManifest,
  type ReviewExecutionBackend,
  type ReviewRoutingEngine,
} from '../../packages/cli/src/generated/handlers/review-router.js';

function engine(id: string, overrides: Partial<EngineDefinition> = {}): EngineDefinition {
  return {
    schemaVersion: 3,
    id,
    displayName: id,
    binary: `${id}-cli`,
    isLocal: false,
    tier: 'user',
    timeout: 300,
    exec: { args: ['run', '{prompt}'] },
    ...overrides,
  } as EngineDefinition;
}

function routed(
  definition: EngineDefinition,
  backend: ReviewExecutionBackend = 'cli',
): ReviewRoutingEngine {
  return { engine: definition, backend };
}

function diff(path: string, body = '+const changed = true;'): string {
  return [
    `diff --git a/${path} b/${path}`,
    `--- a/${path}`,
    `+++ b/${path}`,
    '@@ -1 +1 @@',
    '-const changed = false;',
    body,
  ].join('\n');
}

const primary = engine('primary', { binary: 'primary-cli' });
const alpha = engine('alpha', { binary: 'alpha-cli' });
const beta = engine('beta', { binary: 'beta-cli' });
const gamma = engine('gamma', { binary: 'gamma-cli' });

describe('review risk inference', () => {
  it('classifies docs-only changes as low and ordinary code as medium', () => {
    expect(inferReviewRisk(diff('docs/router.md'), 'auto').final).toBe('low');
    expect(inferReviewRisk(diff('src/router.ts'), 'auto').final).toBe('medium');
  });

  it('never lets an explicit low request lower sensitive inferred risk', () => {
    const decision = inferReviewRisk(diff('src/auth/session.ts'), 'low');

    expect(decision.inferred).toBe('high');
    expect(decision.final).toBe('high');
    expect(decision.triggers).toContain('sensitive-path:src/auth/session.ts');
  });

  it('raises destructive changes to high risk', () => {
    const decision = inferReviewRisk(diff('scripts/cleanup.ts', '+run("rm -rf /tmp/cache");'), 'auto');

    expect(decision.final).toBe('high');
    expect(decision.triggers).toContain('destructive-change');
  });

  it('does not make generated output or destructive test fixtures high risk by itself', () => {
    expect(inferReviewRisk(diff('src/generated/router.ts'), 'auto').final).toBe('medium');
    expect(inferReviewRisk(diff('tests/cleanup.test.ts', '+run("rm -rf /tmp/cache");'), 'auto').final).toBe('low');
    expect(inferReviewRisk(diff('src/users/service.ts', '+await prisma.user.deleteMany({});'), 'auto').final).toBe('medium');
  });
});

describe('automatic reviewer routing', () => {
  it('selects one independent adapter for low risk', () => {
    const sameAsPrimary = engine('primary-alias', { binary: 'primary-cli' });
    const manifest = routeReviewers(
      diff('docs/router.md'),
      'auto',
      routed(primary),
      [primary, sameAsPrimary, alpha, beta].map((definition) => routed(definition)),
    );

    expect(manifest.risk.final).toBe('low');
    expect(manifest.selected).toHaveLength(1);
    expect(manifest.selected[0]?.identityKey).not.toBe('cli:primary-cli');
    expect(manifest.excluded).toEqual(expect.arrayContaining([
      { engineId: 'primary', reason: 'primary-implementer-identity' },
      { engineId: 'primary-alias', reason: 'primary-implementer-identity' },
    ]));
    expect(manifest.shortfall).toBeNull();
  });

  it('selects two distinct adapter identities for medium risk', () => {
    const alphaAlias = engine('alpha-alias', { binary: 'alpha-cli' });
    const manifest = routeReviewers(
      diff('src/router.ts'),
      'auto',
      routed(primary),
      [primary, alpha, alphaAlias, beta, gamma].map((definition) => routed(definition)),
    );

    expect(manifest.risk.final).toBe('medium');
    expect(manifest.selected).toHaveLength(2);
    expect(new Set(manifest.selected.map((candidate) => candidate.identityKey)).size).toBe(2);
    expect(manifest.excluded).toContainEqual({
      engineId: expect.stringMatching(/^alpha(?:-alias)?$/),
      reason: 'duplicate-adapter-identity',
    });
    expect(manifest.shortfall).toBeNull();
  });

  it('uses the complete live input roster for high risk while requiring independence', () => {
    const sparse = engine('sparse', { binary: '' });
    const roster = [primary, alpha, beta, sparse];
    const manifest = routeReviewers(
      diff('src/auth/session.ts'),
      'auto',
      routed(primary),
      [routed(primary), routed(alpha), routed(beta), routed(sparse, 'api')],
    );

    expect(manifest.risk.final).toBe('high');
    expect(manifest.selected.map((candidate) => candidate.engineId).sort()).toEqual(
      roster.map((candidate) => candidate.id).sort(),
    );
    expect(manifest.excluded).toEqual([]);
    expect(manifest.shortfall).toBeNull();
  });

  it('widens to high risk when the primary implementer is unknown', () => {
    const manifest = routeReviewers(
      diff('docs/router.md'),
      'auto',
      undefined,
      [alpha, beta, gamma].map((definition) => routed(definition)),
    );

    expect(manifest.risk.final).toBe('high');
    expect(manifest.risk.triggers).toContain('primary-implementer-unknown');
    expect(manifest.selected).toHaveLength(3);
    expect(manifest.shortfall).toBeNull();
  });

  it('records an unknown primary even when diff evidence already makes risk high', () => {
    const manifest = routeReviewers(
      diff('src/auth/session.ts'),
      'auto',
      undefined,
      [alpha, beta, gamma].map((definition) => routed(definition)),
    );

    expect(manifest.risk.final).toBe('high');
    expect(manifest.risk.triggers).toEqual(expect.arrayContaining([
      'primary-implementer-unknown',
      'sensitive-path:src/auth/session.ts',
    ]));
    expect(manifest.shortfall).toBeNull();
  });

  it('reports a loud shortfall when medium risk lacks two independent identities', () => {
    const alphaAlias = engine('alpha-alias', { binary: 'alpha-cli' });
    const manifest = routeReviewers(
      diff('src/router.ts'),
      'auto',
      routed(primary),
      [primary, alpha, alphaAlias].map((definition) => routed(definition)),
    );

    expect(manifest.selected).toHaveLength(1);
    expect(manifest.shortfall).toEqual({
      required: 2,
      available: 1,
      reason: 'insufficient-independent-adapter-identities',
    });
  });

  it('rejects sparse engine-id-only identity as proof of independence', () => {
    const sparse = engine('sparse', { binary: '' });
    const manifest = routeReviewers(
      diff('docs/router.md'),
      'auto',
      routed(primary),
      [routed(primary), routed(sparse, 'api')],
    );

    expect(manifest.selected).toEqual([]);
    expect(manifest.excluded).toContainEqual({
      engineId: 'sparse',
      reason: 'unverified-adapter-identity',
    });
    expect(manifest.shortfall?.available).toBe(0);
  });

  it('uses the actual execution backend when proving adapter independence', () => {
    const first = engine('first', {
      binary: 'shared-cli',
      api: { baseUrl: 'https://one.example/v1' } as EngineDefinition['api'],
    });
    const second = engine('second', {
      binary: 'shared-cli',
      api: { baseUrl: 'https://two.example/v1' } as EngineDefinition['api'],
    });
    const cliManifest = routeReviewers(
      diff('src/router.ts'),
      'auto',
      routed(primary),
      [routed(first, 'cli'), routed(second, 'cli')],
    );
    const apiManifest = routeReviewers(
      diff('src/router.ts'),
      'auto',
      routed(primary),
      [routed(first, 'api'), routed(second, 'api')],
    );

    expect(cliManifest.selected).toHaveLength(1);
    expect(cliManifest.shortfall?.available).toBe(1);
    expect(apiManifest.selected).toHaveLength(2);
    expect(apiManifest.shortfall).toBeNull();
  });

  it('is deterministic and ignores unrelated rating-shaped metadata', () => {
    const ratedAlpha = { ...alpha, rating: 1 } as EngineDefinition;
    const ratedBeta = { ...beta, rating: 9_999 } as EngineDefinition;
    const inputs = [ratedAlpha, ratedBeta, gamma].map((definition) => routed(definition));
    const first = routeReviewers(diff('src/router.ts'), 'medium', routed(primary), inputs);
    const second = routeReviewers(diff('src/router.ts'), 'medium', routed(primary), inputs);

    expect(serializeReviewRoutingManifest(first)).toBe(serializeReviewRoutingManifest(second));
    expect(first.selected).toEqual(second.selected);
  });
});
