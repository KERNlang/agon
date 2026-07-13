import { describe, it, expect } from 'vitest';
import {
  getModeConfig,
  buildModePrompt,
  buildModeSummaryPrompt,
  isTribunalMode,
  isTribunalProtocol,
  TRIBUNAL_MODES,
  TRIBUNAL_PROTOCOLS,
} from '@kernlang/agon-forge';
import { detectIntent } from '../../packages/cli/src/generated/signals/intent.js';

describe('tribunal-modes', () => {
  describe('TRIBUNAL_MODES', () => {
    it('contains all 6 modes', () => {
      expect(TRIBUNAL_MODES).toEqual(['adversarial', 'socratic', 'red-team', 'steelman', 'synthesis', 'postmortem']);
    });
  });

  describe('isTribunalMode', () => {
    it('returns true for valid modes', () => {
      for (const mode of TRIBUNAL_MODES) {
        expect(isTribunalMode(mode)).toBe(true);
      }
    });

    it('returns false for invalid modes', () => {
      expect(isTribunalMode('freestyle')).toBe(false);
      expect(isTribunalMode('')).toBe(false);
    });
  });

  describe('tribunal protocols', () => {
    it('contains and validates every execution protocol', () => {
      expect(TRIBUNAL_PROTOCOLS).toEqual(['parallel', 'chained', 'hybrid']);
      for (const protocol of TRIBUNAL_PROTOCOLS) {
        expect(isTribunalProtocol(protocol)).toBe(true);
      }
      expect(isTribunalProtocol('sequential')).toBe(false);
      expect(isTribunalProtocol('auto')).toBe(false);
    });
  });

  describe('getModeConfig', () => {
    it('adversarial: FOR/AGAINST for 2 engines', () => {
      const config = getModeConfig('adversarial', 2);
      expect(config.roles).toEqual(['Argue FOR', 'Argue AGAINST']);
      expect(config.protocol).toBe('hybrid');
      expect(config.summaryStyle).toBe('verdict');
    });

    it('adversarial: adds devil advocate for 3 engines', () => {
      const config = getModeConfig('adversarial', 3);
      expect(config.roles).toHaveLength(3);
      expect(config.roles[2]).toContain("devil's advocate");
    });

    it('socratic: questioner + responder for 2 engines', () => {
      const config = getModeConfig('socratic', 2);
      expect(config.roles).toEqual(['Questioner', 'Responder']);
      expect(config.protocol).toBe('chained');
      expect(config.summaryStyle).toBe('questions');
    });

    it('socratic: adds observer for 3 engines', () => {
      const config = getModeConfig('socratic', 3);
      expect(config.roles).toEqual(['Questioner', 'Responder', 'Observer']);
    });

    it('red-team: defender + attackers', () => {
      const config = getModeConfig('red-team', 3);
      expect(config.roles[0]).toBe('Defender');
      expect(config.roles[1]).toContain('Attacker');
      expect(config.roles[2]).toContain('Attacker');
      expect(config.protocol).toBe('hybrid');
      expect(config.summaryStyle).toBe('risk-register');
    });

    it('steelman: advocate + opponent + judge for 3', () => {
      const config = getModeConfig('steelman', 3);
      expect(config.roles).toEqual(['Advocate', 'Steelman opponent', 'Judge']);
      expect(config.protocol).toBe('chained');
    });

    it('synthesis: proposers for 2 engines', () => {
      const config = getModeConfig('synthesis', 2);
      expect(config.roles).toEqual(['Proposer A', 'Proposer B']);
      expect(config.protocol).toBe('parallel');
      expect(config.summaryStyle).toBe('decision-matrix');
    });

    it('postmortem: 3 investigation roles', () => {
      const config = getModeConfig('postmortem', 3);
      expect(config.roles).toContain('Timeline analyst');
      expect(config.roles).toContain('Root-cause investigator');
      expect(config.roles).toContain('Prevention designer');
      expect(config.protocol).toBe('chained');
      expect(config.summaryStyle).toBe('postmortem-report');
    });
  });

  describe('buildModePrompt', () => {
    it('socratic questioner prompt asks questions', () => {
      const prompt = buildModePrompt({
        mode: 'socratic', role: 'Questioner',
        question: 'Is our auth secure?', round: 1, totalRounds: 2,
      });
      expect(prompt).toContain('Questioner');
      expect(prompt).toContain('probing questions');
      expect(prompt).toContain('Do NOT answer');
    });

    it('red-team attacker prompt focuses on vulnerabilities', () => {
      const prompt = buildModePrompt({
        mode: 'red-team', role: 'Attacker 1',
        question: 'Review our payment flow', round: 1, totalRounds: 2,
      });
      expect(prompt).toContain('Attack');
      expect(prompt).toContain('severity');
    });

    it('steelman opponent argues strongest opposing case', () => {
      const prompt = buildModePrompt({
        mode: 'steelman', role: 'Steelman opponent',
        question: 'Should we use microservices?', round: 1, totalRounds: 2,
      });
      expect(prompt).toContain('STRONGEST possible case AGAINST');
    });

    it('synthesis round 2 asks for hybrid', () => {
      const prompt = buildModePrompt({
        mode: 'synthesis', role: 'Proposer A',
        question: 'How to restructure data layer?', round: 2, totalRounds: 2,
        previousArguments: 'Prior proposals here',
      });
      expect(prompt).toContain('hybrid');
      expect(prompt).toContain('decision matrix');
    });

    it('postmortem timeline analyst reconstructs events', () => {
      const prompt = buildModePrompt({
        mode: 'postmortem', role: 'Timeline analyst',
        question: 'Why did deploy fail?', round: 1, totalRounds: 2,
      });
      expect(prompt).toContain('timeline');
      expect(prompt).toContain('blast radius');
    });

    it('includes previous arguments in round 2', () => {
      const prompt = buildModePrompt({
        mode: 'adversarial', role: 'Argue FOR',
        question: 'REST vs GraphQL', round: 2, totalRounds: 2,
        previousArguments: 'Previous round arguments here',
      });
      expect(prompt).toContain('PREVIOUS ARGUMENTS');
      expect(prompt).toContain('Previous round arguments here');
    });

    it('separates earlier current-round arguments from previous rounds', () => {
      const prompt = buildModePrompt({
        mode: 'socratic', role: 'Responder',
        question: 'Is auth secure?', round: 1, totalRounds: 2,
        currentRoundArguments: 'Questioner asked about token rotation',
      });
      expect(prompt).toContain('EARLIER ARGUMENTS THIS ROUND');
      expect(prompt).toContain('Questioner asked about token rotation');
      expect(prompt).not.toContain('PREVIOUS ARGUMENTS');
    });
  });

  describe('buildModeSummaryPrompt', () => {
    const positions = [
      { engineId: 'claude', position: 'Argue FOR', arguments: ['REST is simpler'] },
      { engineId: 'codex', position: 'Argue AGAINST', arguments: ['GraphQL is more flexible'] },
    ];

    it('adversarial asks for verdict', () => {
      const prompt = buildModeSummaryPrompt({ mode: 'adversarial', question: 'REST vs GraphQL', positions });
      expect(prompt).toContain('Verdict');
      expect(prompt).toContain('pick a side');
    });

    it('socratic asks for unresolved assumptions', () => {
      const prompt = buildModeSummaryPrompt({ mode: 'socratic', question: 'Is auth secure?', positions });
      expect(prompt).toContain('Unresolved assumptions');
    });

    it('red-team produces risk register', () => {
      const prompt = buildModeSummaryPrompt({ mode: 'red-team', question: 'Review payment', positions });
      expect(prompt).toContain('risk register');
      expect(prompt).toContain('Severity');
    });

    it('synthesis produces decision matrix', () => {
      const prompt = buildModeSummaryPrompt({ mode: 'synthesis', question: 'How to restructure?', positions });
      expect(prompt).toContain('decision matrix');
    });

    it('postmortem produces postmortem report', () => {
      const prompt = buildModeSummaryPrompt({ mode: 'postmortem', question: 'Why did deploy fail?', positions });
      expect(prompt).toContain('Root cause');
      expect(prompt).toContain('Prevention plan');
    });
  });

  describe('intent parsing — tribunal modes', () => {
    it('/tribunal socratic <question> extracts mode', () => {
      const intent = detectIntent('/tribunal socratic Is our error handling resilient?');
      expect(intent.type).toBe('tribunal');
      expect((intent as any).tribunalMode).toBe('socratic');
      expect(intent.question).toBe('Is our error handling resilient?');
    });

    it('/tribunal --red-team <question> extracts mode', () => {
      const intent = detectIntent('/tribunal --red-team Review the new API');
      expect(intent.type).toBe('tribunal');
      expect((intent as any).tribunalMode).toBe('red-team');
      expect(intent.question).toBe('Review the new API');
    });

    it('/tribunal --mode steelman <question> extracts mode', () => {
      const intent = detectIntent('/tribunal --mode steelman Should we migrate?');
      expect(intent.type).toBe('tribunal');
      expect((intent as any).tribunalMode).toBe('steelman');
      expect(intent.question).toBe('Should we migrate?');
    });

    it('/tribunal <question> defaults to no explicit mode', () => {
      const intent = detectIntent('/tribunal Should we use REST or GraphQL?');
      expect(intent.type).toBe('tribunal');
      expect((intent as any).tribunalMode).toBeUndefined();
      expect(intent.question).toBe('Should we use REST or GraphQL?');
    });

    it('/tribunal postmortem <question> extracts mode', () => {
      const intent = detectIntent('/tribunal postmortem Why did the deploy fail?');
      expect(intent.type).toBe('tribunal');
      expect((intent as any).tribunalMode).toBe('postmortem');
    });

    it('/tribunal synthesis <question> extracts mode', () => {
      const intent = detectIntent('/tribunal synthesis How should we restructure?');
      expect(intent.type).toBe('tribunal');
      expect((intent as any).tribunalMode).toBe('synthesis');
    });

    it('/tribunal accepts mode and protocol independently', () => {
      const intent = detectIntent('/tribunal --mode red-team --protocol parallel Review the rollout');
      expect(intent.type).toBe('tribunal');
      expect((intent as any).tribunalMode).toBe('red-team');
      expect((intent as any).tribunalProtocol).toBe('parallel');
      expect(intent.question).toBe('Review the rollout');
    });

    it('/tribunal accepts a protocol override after a shorthand mode', () => {
      const intent = detectIntent('/tribunal socratic Can this scale? --protocol chained');
      expect(intent.type).toBe('tribunal');
      expect((intent as any).tribunalMode).toBe('socratic');
      expect((intent as any).tribunalProtocol).toBe('chained');
      expect(intent.question).toBe('Can this scale?');
    });

    it('/tribunal accepts auto as the mode-specific protocol default', () => {
      const intent = detectIntent('/tribunal --protocol auto Should defaults follow the mode?');
      expect(intent.type).toBe('tribunal');
      expect((intent as any).tribunalProtocol).toBe('auto');
      expect(intent.question).toBe('Should defaults follow the mode?');
    });
  });
});
