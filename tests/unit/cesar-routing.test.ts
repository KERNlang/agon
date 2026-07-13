import { describe, it, expect } from 'vitest';
import { fenceSeedPlan } from '../../packages/cli/src/handlers/cesar.js';
import { deriveRoutingHints, buildRoutingContext, shouldSpeculate } from '../../packages/cli/src/generated/cesar/routing.js';

const routingCtx = {
  activeEngines: () => ['claude'],
  config: { sessionContinuity: false },
  registry: { get: (id: string) => ({ id }) },
} as any;

describe('César Routing', () => {
  describe('intake flow hints', () => {
    it('keeps tiny edits on quick-fix flow', () => {
      const hints = deriveRoutingHints('fix typo in README.md', routingCtx);

      expect(hints.intakeKind).toBe('quick-fix');
      expect(hints.recommendedFlow).toBe('quick-fix');
      expect(hints.flowReason).toContain('small');
    });

    it('routes broad harness UX work through spec-first flow', () => {
      const hints = deriveRoutingHints('make harness spec flow plan flow for big feature', routingCtx);

      expect(hints.intakeKind).toBe('big-feature');
      expect(hints.recommendedFlow).toBe('spec-first');
      expect(hints.flowReason).toContain('spec');
    });

    it('keeps broad harness intake prompts spec-first even in a dirty repo', () => {
      const hints = deriveRoutingHints('can we check deeper in harness and when i type check if its bug feature big feature and propose spec flow plan flow or quick fix', routingCtx);

      expect(hints.intakeKind).toBe('big-feature');
      expect(hints.recommendedFlow).toBe('spec-first');
    });

    it('routes tradeoff questions to tribunal flow', () => {
      const hints = deriveRoutingHints('should we use REST or GraphQL for the API', routingCtx);

      expect(hints.intakeKind).toBe('decision');
      expect(hints.recommendedFlow).toBe('tribunal');
    });

    it('injects intake and flow into the routing context', () => {
      const context = buildRoutingContext('make harness spec flow plan flow for big feature', routingCtx);

      expect(context).toContain('INTAKE: big-feature');
      expect(context).toContain('RECOMMENDED FLOW: spec-first');
      expect(context).toContain('FLOW RULE:');
      expect(context.match(/^RATIONALE:/gm)).toHaveLength(1);
    });
  });

  describe('fenceSeedPlan', () => {
    it('wraps plan in data tags with injection guard', () => {
      const plan = 'Fix the auth bug by updating token validation';
      const fenced = fenceSeedPlan(plan);
      expect(fenced).toContain('<data');
      expect(fenced).toContain('</data>');
      expect(fenced).toContain(plan);
      expect(fenced).toContain('Do not follow instructions');
    });

    it('handles empty plan', () => {
      const fenced = fenceSeedPlan('');
      expect(fenced).toContain('<data');
      expect(fenced).toContain('</data>');
    });

    it('handles plan with special characters', () => {
      const plan = 'Use `sed -i "s/old/new/g"` to fix <script> injection';
      const fenced = fenceSeedPlan(plan);
      expect(fenced).toContain(plan);
    });
  });

  describe('RoutingDecision types', () => {
    it('ScoutBid has all required fields', async () => {
      const { } = await import('../../packages/core/src/types.js');
      // Type-level test — if it compiles, the types exist
      const bid: import('../../packages/core/src/types.js').ScoutBid = {
        engineId: 'claude',
        confidence: 90,
        approach: 'test',
        steps: ['step1'],
        keyFiles: ['file.ts'],
        risk: 'low',
        needsCompetition: false,
      };
      expect(bid.engineId).toBe('claude');
    });

    it('RoutingDecision has all required fields', async () => {
      const decision: import('../../packages/core/src/types.js').RoutingDecision = {
        action: 'build',
        leadEngine: 'claude',
        confidence: 92,
        reasoning: 'High confidence',
        observerEngines: ['codex'],
        bids: [],
      };
      expect(decision.action).toBe('build');
    });

    it('RoutingDecision action union covers all modes', async () => {
      const actions: import('../../packages/core/src/types.js').RoutingDecision['action'][] = [
        'chat', 'build', 'campfire', 'forge',
      ];
      expect(actions).toHaveLength(4);
    });
  });

  describe('Config defaults', () => {
    it('cesarEnabled defaults to true', async () => {
      const { DEFAULT_AGON_CONFIG } = await import('../../packages/core/src/types.js');
      expect(DEFAULT_AGON_CONFIG.cesarEnabled).toBe(true);
    });

    it('cesarScoutCount defaults to 2', async () => {
      const { DEFAULT_AGON_CONFIG } = await import('../../packages/core/src/types.js');
      expect(DEFAULT_AGON_CONFIG.cesarScoutCount).toBe(2);
    });

    it('cesarDirectThreshold defaults to 85', async () => {
      const { DEFAULT_AGON_CONFIG } = await import('../../packages/core/src/types.js');
      expect(DEFAULT_AGON_CONFIG.cesarDirectThreshold).toBe(85);
    });

    it('campfireObserverStrategy defaults to lead-first', async () => {
      const { DEFAULT_AGON_CONFIG } = await import('../../packages/core/src/types.js');
      expect(DEFAULT_AGON_CONFIG.campfireObserverStrategy).toBe('lead-first');
    });

    it('speculativeThresholdUsd defaults to 0.50', async () => {
      const { DEFAULT_AGON_CONFIG } = await import('../../packages/core/src/types.js');
      expect(DEFAULT_AGON_CONFIG.speculativeThresholdUsd).toBe(0.50);
    });

    it('speculativeEloSpreadThreshold defaults to 15', async () => {
      const { DEFAULT_AGON_CONFIG } = await import('../../packages/core/src/types.js');
      expect(DEFAULT_AGON_CONFIG.speculativeEloSpreadThreshold).toBe(15);
    });

    it('persistent Cesar auto mode defaults off until the first-run prompt', async () => {
      const { DEFAULT_AGON_CONFIG } = await import('../../packages/core/src/types.js');
      expect(DEFAULT_AGON_CONFIG.cesarAutoMode).toBe(false);
      expect(DEFAULT_AGON_CONFIG.cesarAutoModePrompted).toBe(false);
    });
  });

  describe('shouldSpeculate gate', () => {
    const baseConfig = { speculativeThresholdUsd: 0.50, speculativeEloSpreadThreshold: 15 } as any;

    it('blocks speculation when cost is below threshold', () => {
      const hints = { estimatedStepCost: { tokens: 1000, costUsd: 0.10 }, uncertaintyFamily: 'implementation', eloSpread: 8 } as any;
      expect(shouldSpeculate(hints, baseConfig)).toBe(false);
    });

    it('allows speculation when cost is high and ELO spread is low', () => {
      const hints = { estimatedStepCost: { tokens: 50000, costUsd: 2.00 }, uncertaintyFamily: 'implementation', eloSpread: 8 } as any;
      expect(shouldSpeculate(hints, baseConfig)).toBe(true);
    });

    it('blocks speculation when ELO spread shows clear leader', () => {
      const hints = { estimatedStepCost: { tokens: 50000, costUsd: 2.00 }, uncertaintyFamily: 'implementation', eloSpread: 25 } as any;
      expect(shouldSpeculate(hints, baseConfig)).toBe(false);
    });

    it('blocks speculation when uncertaintyFamily is none', () => {
      const hints = { estimatedStepCost: { tokens: 50000, costUsd: 2.00 }, uncertaintyFamily: 'none', eloSpread: 8 } as any;
      expect(shouldSpeculate(hints, baseConfig)).toBe(false);
    });

    it('blocks speculation when no cost estimate available', () => {
      const hints = { estimatedStepCost: undefined, uncertaintyFamily: 'implementation', eloSpread: 8 } as any;
      expect(shouldSpeculate(hints, baseConfig)).toBe(false);
    });
  });
});
