import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadEngineMemory, addEngineNote, setEngineStrengths,
  setEngineWeaknesses, addEngineTendency, getEngineProfile,
  buildRolePrompt, recordForgeOutcome,
} from '../../packages/core/src/generated/blocks/engine-memory.js';
import { rmSync } from 'node:fs';
import { agonHomePath, cleanupTestAgonHome, setupTestAgonHome } from '../helpers/agon-home.js';

describe('EngineMemory', () => {
  let testHome = '';

  beforeEach(() => {
    testHome = setupTestAgonHome('engine-memory');
  });

  afterEach(() => {
    cleanupTestAgonHome(testHome);
  });

  it('loadEngineMemory returns empty record when no file', () => {
    rmSync(agonHomePath('engine-memory.json'), { force: true });
    const record = loadEngineMemory();
    expect(record.engines).toEqual({});
  });

  it('addEngineNote creates profile and stores note', () => {
    rmSync(agonHomePath('engine-memory.json'), { force: true });
    addEngineNote('claude', 'bugfix', 'Fixed auth issue quickly');
    const profile = getEngineProfile('claude');
    expect(profile).not.toBeNull();
    expect(profile!.notes).toHaveLength(1);
    expect(profile!.notes[0].observation).toBe('Fixed auth issue quickly');
    expect(profile!.notes[0].taskClass).toBe('bugfix');
  });

  it('setEngineStrengths persists', () => {
    rmSync(agonHomePath('engine-memory.json'), { force: true });
    setEngineStrengths('codex', ['fast execution', 'good at refactoring']);
    const profile = getEngineProfile('codex');
    expect(profile!.strengths).toEqual(['fast execution', 'good at refactoring']);
  });

  it('setEngineWeaknesses persists', () => {
    rmSync(agonHomePath('engine-memory.json'), { force: true });
    setEngineWeaknesses('gemini', ['slow responses', 'misses edge cases']);
    const profile = getEngineProfile('gemini');
    expect(profile!.weaknesses).toEqual(['slow responses', 'misses edge cases']);
  });

  it('addEngineTendency deduplicates', () => {
    rmSync(agonHomePath('engine-memory.json'), { force: true });
    addEngineTendency('codex', 'over-engineers');
    addEngineTendency('codex', 'over-engineers');
    addEngineTendency('codex', 'good tests');
    const profile = getEngineProfile('codex');
    expect(profile!.tendencies).toEqual(['over-engineers', 'good tests']);
  });

  it('buildRolePrompt returns empty for unknown engine', () => {
    rmSync(agonHomePath('engine-memory.json'), { force: true });
    expect(buildRolePrompt('unknown-engine', 'bugfix')).toBe('');
  });

  it('buildRolePrompt includes strengths and notes', () => {
    rmSync(agonHomePath('engine-memory.json'), { force: true });
    setEngineStrengths('claude', ['architecture', 'debugging']);
    addEngineNote('claude', 'refactor', 'Clean refactoring approach');
    const prompt = buildRolePrompt('claude', 'refactor');
    expect(prompt).toContain('architecture');
    expect(prompt).toContain('Clean refactoring approach');
  });

  it('recordForgeOutcome logs winner and losers', () => {
    rmSync(agonHomePath('engine-memory.json'), { force: true });
    recordForgeOutcome('claude', ['codex', 'gemini'], 'feature', 'forge-123', 92, { codex: 78, gemini: 0 });

    const claudeProfile = getEngineProfile('claude');
    expect(claudeProfile!.notes.some(n => n.observation.includes('Won'))).toBe(true);

    const codexProfile = getEngineProfile('codex');
    expect(codexProfile!.notes.some(n => n.observation.includes('Lost'))).toBe(true);

    const geminiProfile = getEngineProfile('gemini');
    expect(geminiProfile!.notes.some(n => n.observation.includes('Failed'))).toBe(true);
  });

  it('caps notes at 50 per engine', () => {
    rmSync(agonHomePath('engine-memory.json'), { force: true });
    for (let i = 0; i < 60; i++) {
      addEngineNote('claude', 'bugfix', `Note ${i}`);
    }
    const profile = getEngineProfile('claude');
    expect(profile!.notes).toHaveLength(50);
    expect(profile!.notes[0].observation).toBe('Note 10'); // First 10 dropped
  });
});
