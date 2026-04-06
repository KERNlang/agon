import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// ── 1. Config Corruption Handling ──────────────────────────────────
describe('Config Corruption Handling', () => {
  it('EngineRegistry warns on corrupt JSON and continues loading', async () => {
    const { EngineRegistry } = await import('../../packages/core/src/engine-registry.js');
    const registry = new EngineRegistry();

    const tempDir = join(tmpdir(), `agon-test-corrupt-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });

    // Write a valid engine
    writeFileSync(join(tempDir, 'valid.json'), JSON.stringify({
      schemaVersion: 3,
      id: 'test-valid',
      displayName: 'Test Valid',
      isLocal: false,
      tier: 'user',
      timeout: 60,
      exec: { args: ['{prompt}'] },
    }));

    // Write a corrupt engine
    writeFileSync(join(tempDir, 'corrupt.json'), '{ "id": "broken", invalid json }');

    // Write a schema-invalid engine (missing required fields)
    writeFileSync(join(tempDir, 'invalid.json'), JSON.stringify({
      schemaVersion: 3,
      id: 'test-invalid',
      // missing displayName, isLocal, timeout
    }));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // loadDir is private, but load() takes a builtinDir. Use the temp dir.
    // We call load() with the temp dir as the builtin dir.
    registry.load(tempDir);

    // Should have loaded the valid engine
    expect(registry.listIds()).toContain('test-valid');

    // Should have warned about corrupt JSON
    const warnings = warnSpy.mock.calls.map(c => c[0]);
    expect(warnings.some((w: string) => w.includes('failed to load engine definition corrupt.json'))).toBe(true);

    warnSpy.mockRestore();
    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ── 2. Manifest/History Writes ─────────────────────────────────────
describe('Manifest Writes', () => {
  it('sidechain logger creates JSONL file and writes events', async () => {
    const { createSidechainLogger } = await import('../../packages/core/src/sidechain-logger.js');
    const tempDir = join(tmpdir(), `agon-test-sidechain-${Date.now()}`);

    const logger = createSidechainLogger({
      sessionId: 'test-123',
      sessionType: 'forge',
      outputDir: tempDir,
    });

    logger.log('start', 'claude', { task: 'test task' });
    logger.log('score', 'codex', { score: 85 });

    // Verify file was created
    expect(existsSync(logger.path)).toBe(true);

    // Verify JSONL content
    const lines = readFileSync(logger.path, 'utf-8').trim().split('\n');
    expect(lines.length).toBe(2);

    const event1 = JSON.parse(lines[0]);
    expect(event1.type).toBe('start');
    expect(event1.engineId).toBe('claude');
    expect(event1.sessionId).toBe('test-123');

    const event2 = JSON.parse(lines[1]);
    expect(event2.type).toBe('score');
    expect(event2.data.score).toBe(85);

    rmSync(tempDir, { recursive: true, force: true });
  });

  it('sidechain logger child creates nested log', async () => {
    const { createSidechainLogger } = await import('../../packages/core/src/sidechain-logger.js');
    const tempDir = join(tmpdir(), `agon-test-sidechain-child-${Date.now()}`);

    const parent = createSidechainLogger({
      sessionId: 'parent-abc',
      sessionType: 'forge',
      outputDir: tempDir,
    });

    const child = parent.child('child-def', 'tribunal');
    child.log('argument', 'gemini');

    expect(child.path).toContain('sidechain_parent-abc');
    expect(existsSync(child.path)).toBe(true);

    const line = JSON.parse(readFileSync(child.path, 'utf-8').trim());
    expect(line.parentId).toBe('parent-abc');
    expect(line.sessionType).toBe('tribunal');

    rmSync(tempDir, { recursive: true, force: true });
  });
});

// ── 3. Cesar/Nero Confidence Tiers ────────────────────────────────
describe('Nero ↔ Cesar Confidence Transitions', () => {
  it('CONFIDENCE_TIERS define correct escalation ladder', async () => {
    const { CONFIDENCE_TIERS } = await import('../../packages/cli/src/handlers/cesar-brain.js');

    // direct > nero/suggest > stop — escalation order must hold
    expect(CONFIDENCE_TIERS.direct).toBeGreaterThan(CONFIDENCE_TIERS.suggest);
    expect(CONFIDENCE_TIERS.suggest).toBeGreaterThanOrEqual(CONFIDENCE_TIERS.nero);
    expect(CONFIDENCE_TIERS.nero).toBeGreaterThan(CONFIDENCE_TIERS.stop);

    // Nero activates below direct threshold
    expect(CONFIDENCE_TIERS.nero).toBeLessThan(CONFIDENCE_TIERS.direct);
  });

  it('confidence badge returns correct color for each tier', async () => {
    const { confidenceBadge } = await import('../../packages/cli/src/handlers/cesar-brain.js');

    // ≥94 → green (badge uses 94 threshold)
    const highBadge = confidenceBadge(94);
    expect(highBadge).toContain('\x1b[32m'); // green

    // 90-93 → yellow
    const midBadge = confidenceBadge(93);
    expect(midBadge).toContain('\x1b[33m'); // yellow

    // <70 → red
    const lowBadge = confidenceBadge(60);
    expect(lowBadge).toContain('\x1b[31m'); // red
  });

  it('parseConfidence extracts ~X% from response start', async () => {
    const { parseConfidence } = await import('../../packages/cli/src/handlers/cesar-brain.js');

    const result = parseConfidence('~92% This task requires code changes.');
    expect(result.value).toBe(92);
    expect(result.rest).toBe('This task requires code changes.');
  });

  it('parseConfidence extracts Confidence: 0.X from response start', async () => {
    const { parseConfidence } = await import('../../packages/cli/src/handlers/cesar-brain.js');

    const result = parseConfidence('Confidence: 0.85 I suggest using build mode.');
    expect(result.value).toBe(85);
  });

  it('parseSuggestion extracts [SUGGEST:mode] from response', async () => {
    const { parseSuggestion } = await import('../../packages/cli/src/handlers/cesar-brain.js');

    const result = parseSuggestion('[SUGGEST:forge] This task needs competitive evaluation.');
    expect(result.action).toBe('forge');
    expect(result.rest).toContain('competitive evaluation');
  });
});

// ── 4. Output Directory Creation ───────────────────────────────────
describe('Output Directory Creation', () => {
  it('sidechain logger creates nested output dirs', async () => {
    const { createSidechainLogger } = await import('../../packages/core/src/sidechain-logger.js');
    const tempDir = join(tmpdir(), `agon-test-outdir-${Date.now()}`, 'nested', 'deep');

    // Should create the full path without throwing
    const logger = createSidechainLogger({
      sessionId: 'outdir-test',
      sessionType: 'forge',
      outputDir: tempDir,
    });

    logger.log('test');
    expect(existsSync(tempDir)).toBe(true);
    expect(existsSync(logger.path)).toBe(true);

    rmSync(join(tmpdir(), `agon-test-outdir-${Date.now()}`), { recursive: true, force: true });
  });
});

// ── 5. Scoring Integration ─────────────────────────────────────────
describe('Scoring ↔ Winner Determination Integration', () => {
  it('computeScore feeds correctly into determineWinner', async () => {
    const { computeScore } = await import('../../packages/core/src/scoring.js');
    const { determineWinner } = await import('../../packages/forge/src/stages.js');

    // Simulate two engines with real scoring
    const claudeScore = computeScore({
      pass: true,
      diffLines: 20,
      filesChanged: 1,
      durationSec: 15,
      lintWarnings: 0,
      styleScore: 100,
      compositeScore: 0,
    });

    const codexScore = computeScore({
      pass: true,
      diffLines: 200,
      filesChanged: 8,
      durationSec: 120,
      lintWarnings: 5,
      styleScore: 60,
      compositeScore: 0,
    });

    const results = new Map<string, EngineResult>();
    results.set('claude', {
      engineId: 'claude',
      pass: true,
      score: claudeScore.composite,
      diffLines: 20,
      filesChanged: 1,
      durationSec: 15,
      lintWarnings: 0,
      styleScore: 100,
    });
    results.set('codex', {
      engineId: 'codex',
      pass: true,
      score: codexScore.composite,
      diffLines: 200,
      filesChanged: 8,
      durationSec: 120,
      lintWarnings: 5,
      styleScore: 60,
    });

    const { winner, closeCall } = determineWinner(results);

    // Clean, focused changes should win over scattered, slow changes
    expect(winner).toBe('claude');
    expect(claudeScore.composite).toBeGreaterThan(codexScore.composite);
  });

  it('close call detected when scores are within spread', async () => {
    const { computeScore } = await import('../../packages/core/src/scoring.js');
    const { determineWinner } = await import('../../packages/forge/src/stages.js');

    // Two nearly identical results
    const results = new Map();
    results.set('claude', {
      engineId: 'claude',
      pass: true,
      score: 85,
      diffLines: 50,
      filesChanged: 2,
      durationSec: 30,
      lintWarnings: 0,
      styleScore: 100,
    });
    results.set('codex', {
      engineId: 'codex',
      pass: true,
      score: 82,
      diffLines: 55,
      filesChanged: 2,
      durationSec: 35,
      lintWarnings: 1,
      styleScore: 95,
    });

    const { closeCall } = determineWinner(results);
    expect(closeCall).toBe(true);
  });
});

// ── 6. Task Classification ↔ Routing ──────────────────────────────
describe('Task Classification → Routing Pipeline', () => {
  it('classifyTask returns valid task class for all categories', async () => {
    const { classifyTask } = await import('../../packages/core/src/task-classifier.js');

    const cases: [string, string][] = [
      ['implement a binary search tree', 'algorithm'],
      ['refactor the payment module', 'refactor'],
      ['fix the null pointer crash on login', 'bugfix'],
      ['add unit tests for the API layer', 'test'],
      ['update the readme and docs', 'docs'],
      ['add a dark mode toggle', 'feature'],
      ['do something random', 'other'],
    ];

    for (const [input, expected] of cases) {
      expect(classifyTask(input)).toBe(expected);
    }
  });

  it('prompt builders include task context', async () => {
    const { buildForgePrompt } = await import('../../packages/core/src/prompt-builder.js');
    const { classifyTask } = await import('../../packages/core/src/task-classifier.js');

    const task = 'refactor the auth module to use JWT tokens';
    const taskClass = classifyTask(task);
    expect(taskClass).toBe('refactor');

    const prompt = buildForgePrompt({ task, fitnessCmd: 'npm test' });
    expect(prompt).toContain(task);
    expect(prompt).toContain('npm test');
  });
});
