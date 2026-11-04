import { describe, it, expect } from 'vitest';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProgram, readConfigFile, parseJsonConfigFileContent, sys } from 'typescript';
import * as judgeOwner from '@kernlang/agon-support-judge';
import { determineWinner as coreDetermineWinner } from '@kernlang/agon-core';
import {
  classifyNoDiffForgeResult,
  determineWinner,
  resolveForgeAcceptReviewOutput,
  resolveForgeMode,
  resolveForgeRequireDiff,
} from '../../packages/forge/src/stages.js';
import { classifyTask } from '../../packages/core/src/blocks/task-classifier.js';
import { buildForgePrompt, buildCritiquePrompt, buildSynthesisPrompt, buildBrainstormPrompt, buildTribunalPrompt } from '../../packages/core/src/blocks/prompt-builder.js';
import type { EngineResult, Critique } from '../../packages/core/src/models/types.js';

function makeResult(overrides: Partial<EngineResult> = {}): EngineResult {
  return {
    engineId: 'test',
    pass: true,
    score: 80,
    diffLines: 50,
    filesChanged: 2,
    durationSec: 30,
    lintWarnings: 0,
    styleScore: 100,
    ...overrides,
  };
}

describe('Forge Integration', () => {
  describe('determineWinner', () => {
    it('preserves the legacy Core candidate type for declaration consumers', () => {
      const configPath = fileURLToPath(new URL('../../packages/core/tsconfig.json', import.meta.url));
      const config = readConfigFile(configPath, sys.readFile);
      const parsed = parseJsonConfigFileContent(config.config, sys, dirname(configPath));
      const program = createProgram(parsed.fileNames, parsed.options);
      const checker = program.getTypeChecker();
      const source = program.getSourceFile(fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)))!;
      const module = checker.getSymbolAtLocation(source)!;
      const symbol = checker.getExportsOfModule(module).find(symbol => symbol.name === 'determineWinner')!;
      const signature = checker.getTypeOfSymbolAtLocation(symbol, source).getCallSignatures()[0];
      const mapType = checker.getTypeOfSymbolAtLocation(signature.parameters[0], source);
      const candidate = checker.getTypeArguments(mapType as import('typescript').TypeReference)[1];
      expect(checker.typeToString(candidate)).toBe('EngineResult');
      expect(candidate.getProperty('engineId')).toBeDefined();
      expect(candidate.getProperty('patchPath')).toBeDefined();
    });

    it('uses one shared owner for Core and Forge ranking', () => {
      expect(judgeOwner).toHaveProperty('determineWinner', coreDetermineWinner);
    });

    it.each([
      ['score', 90, 80],
      ['lintWarnings', 0, 1],
      ['styleScore', 100, 80],
      ['diffLines', 10, 20],
      ['filesChanged', 1, 2],
      ['durationSec', 10, 20],
    ] as const)('ranks by %s without changing the input', (field, better, worse) => {
      const results = new Map([
        ['worse', makeResult({ [field]: worse })],
        ['better', makeResult({ [field]: better })],
      ]);
      const before = [...results.entries()].map(([id, value]) => [id, { ...value }]);
      expect(determineWinner(results).winner).toBe('better');
      expect([...results.entries()]).toEqual(before);
    });

    it('excludes passing zero scores and treats the exact spread as not close', () => {
      expect(determineWinner(new Map([['zero', makeResult({ score: 0 })]])))
        .toEqual({ winner: null, closeCall: false, bestScore: 0, secondScore: 0 });
      expect(determineWinner(new Map([
        ['best', makeResult({ score: 88 })], ['second', makeResult({ score: 80 })],
      ]), 8)).toEqual({ winner: 'best', closeCall: false, bestScore: 88, secondScore: 80 });
    });

    it('picks the highest scoring passing engine', () => {
      const results = new Map<string, EngineResult>();
      results.set('claude', makeResult({ engineId: 'claude', score: 95 }));
      results.set('codex', makeResult({ engineId: 'codex', score: 70 }));
      results.set('gemini', makeResult({ engineId: 'gemini', score: 80 }));

      const { winner, closeCall } = determineWinner(results);
      expect(winner).toBe('claude');
      expect(closeCall).toBe(false);
    });

    it('detects close calls (spread < 8)', () => {
      const results = new Map<string, EngineResult>();
      results.set('claude', makeResult({ engineId: 'claude', score: 85 }));
      results.set('codex', makeResult({ engineId: 'codex', score: 82 }));

      const { closeCall } = determineWinner(results);
      expect(closeCall).toBe(true);
    });

    it('excludes failing engines', () => {
      const results = new Map<string, EngineResult>();
      results.set('claude', makeResult({ engineId: 'claude', score: 95, pass: false }));
      results.set('codex', makeResult({ engineId: 'codex', score: 70 }));

      const { winner } = determineWinner(results);
      expect(winner).toBe('codex');
    });

    it('returns null when all fail', () => {
      const results = new Map<string, EngineResult>();
      results.set('claude', makeResult({ pass: false, score: 0 }));
      results.set('codex', makeResult({ pass: false, score: 0 }));

      const { winner } = determineWinner(results);
      expect(winner).toBeNull();
    });

    it('uses tiebreaker on equal scores', () => {
      const results = new Map<string, EngineResult>();
      results.set('claude', makeResult({ engineId: 'claude', score: 80, lintWarnings: 1 }));
      results.set('codex', makeResult({ engineId: 'codex', score: 80, lintWarnings: 0 }));

      const { winner } = determineWinner(results);
      expect(winner).toBe('codex'); // fewer lint warnings
    });
  });

  describe('no-diff forge classification', () => {
    it('keeps API tool-loop exhaustion distinct from validation no-ops', () => {
      const result = classifyNoDiffForgeResult({
        stdout: 'API engine reached the 40-step tool loop limit after 40 tool calls; evaluating any candidate worktree changes with fitness.',
        timedOut: false,
        exitCode: 0,
        fitnessPassed: true,
        baselinePasses: true,
        mode: 'improve',
        requireDiff: false,
        acceptReviewOutput: true,
      });

      expect(result).toMatchObject({
        status: 'no_patch_tool_limit',
        pass: false,
        score: 0,
        engineCompleted: false,
        reason: 'tool_loop_limit',
      });
    });

    it('accepts useful no-diff reports in validate mode', () => {
      const result = classifyNoDiffForgeResult({
        stdout: 'The review covers module exports, use-from semantics, external boundaries, and test gaps; it recommends keeping the implementation as-is because all checked behaviors pass.',
        timedOut: false,
        exitCode: 0,
        fitnessPassed: true,
        baselinePasses: true,
        mode: 'validate',
        requireDiff: false,
        acceptReviewOutput: true,
      });

      expect(result.status).toBe('no_diff_but_report');
      expect(result.pass).toBe(true);
      expect(result.score).toBeGreaterThan(0);
    });

    it('defaults implement to require diff and validate to allow no diff', () => {
      expect(resolveForgeMode('VALIDATE')).toBe('validate');
      expect(resolveForgeMode('unknown')).toBe('implement');
      expect(resolveForgeRequireDiff('implement')).toBe(true);
      expect(resolveForgeRequireDiff('validate')).toBe(false);
      expect(resolveForgeRequireDiff('validate', true)).toBe(true);
      expect(resolveForgeAcceptReviewOutput('implement')).toBe(false);
      expect(resolveForgeAcceptReviewOutput('improve')).toBe(true);
    });
  });

  describe('classifyTask', () => {
    it('detects algorithm tasks', () => {
      expect(classifyTask('implement a sorting algorithm')).toBe('algorithm');
    });

    it('detects refactor tasks', () => {
      expect(classifyTask('refactor the auth module')).toBe('refactor');
    });

    it('detects bugfix tasks', () => {
      expect(classifyTask('fix the login crash')).toBe('bugfix');
    });

    it('detects test tasks', () => {
      expect(classifyTask('add unit tests for scoring')).toBe('test');
    });

    it('detects docs tasks', () => {
      expect(classifyTask('update the README')).toBe('docs');
    });

    it('keeps README tasks as docs even when constraints mention scoring', () => {
      expect(classifyTask('write a README and avoid scoring weights')).toBe('docs');
    });

    it('detects feature tasks', () => {
      expect(classifyTask('add a new export command')).toBe('feature');
    });

    it('defaults to other', () => {
      expect(classifyTask('do the thing')).toBe('other');
    });

    it('is case insensitive', () => {
      expect(classifyTask('FIX the BUG')).toBe('bugfix');
    });
  });

  describe('Prompt builders', () => {
    it('buildForgePrompt includes task and fitness', () => {
      const prompt = buildForgePrompt({
        task: 'Add hello world',
        fitnessCmd: 'npm test',
      });
      expect(prompt).toContain('Add hello world');
      expect(prompt).toContain('npm test');
      expect(prompt).toContain('CONSTRAINTS');
    });

    it('buildForgePrompt includes optional context', () => {
      const prompt = buildForgePrompt({
        task: 'Add hello world',
        fitnessCmd: 'npm test',
        context: 'TypeScript project',
      });
      expect(prompt).toContain('TypeScript project');
    });

    it('buildCritiquePrompt caps diff at 50K', () => {
      const longDiff = 'x'.repeat(60_000);
      const prompt = buildCritiquePrompt({
        winnerEngine: 'claude',
        diff: longDiff,
        maxCritiques: 3,
      });
      expect(prompt).toContain('[truncated]');
      expect(prompt.length).toBeLessThan(60_000);
    });

    it('buildSynthesisPrompt includes critiques', () => {
      const critiques: Critique[] = [
        { file: 'src/index.ts', lines: '10-15', problem: 'Missing null check', minimalFix: 'Add if (!x) return' },
      ];
      const prompt = buildSynthesisPrompt({
        diff: '+ some code',
        critiques,
        fitnessCmd: 'npm test',
      });
      expect(prompt).toContain('Missing null check');
      expect(prompt).toContain('src/index.ts');
    });

    it('buildBrainstormPrompt includes question', () => {
      const prompt = buildBrainstormPrompt({
        question: 'What architecture should we use?',
      });
      expect(prompt).toContain('What architecture should we use?');
      expect(prompt).toContain('confidence');
    });

    it('buildTribunalPrompt includes question and position', () => {
      const prompt = buildTribunalPrompt({
        question: 'Should we use microservices?',
        position: 'Argue FOR',
        round: 1,
        totalRounds: 2,
      });
      expect(prompt).toContain('Should we use microservices?');
      expect(prompt).toContain('Argue FOR');
      expect(prompt).toContain('Round: 1/2');
    });

    it('buildTribunalPrompt includes previous arguments in round 2+', () => {
      const prompt = buildTribunalPrompt({
        question: 'Monolith vs microservices?',
        position: 'Argue AGAINST',
        round: 2,
        totalRounds: 2,
        previousArguments: 'Claude argued FOR: scalability matters...',
      });
      expect(prompt).toContain('PREVIOUS ARGUMENTS');
      expect(prompt).toContain('scalability matters');
      expect(prompt).toContain('Address and counter');
    });
  });
});
