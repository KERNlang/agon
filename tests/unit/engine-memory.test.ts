import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  loadEngineMemory, addEngineNote, setEngineStrengths,
  setEngineWeaknesses, addEngineTendency, getEngineProfile,
  buildRolePrompt, recordForgeOutcome,
} from '../../packages/core/src/generated/engine-memory.js';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// Engine memory writes to ~/.agon/engine-memory.json
// We'll test with real file ops but clean up after
const MEMORY_PATH = join(homedir(), '.agon', 'engine-memory.json');
const BACKUP_PATH = MEMORY_PATH + '.test-backup';

describe('EngineMemory', () => {
  let hadExistingFile = false;

  beforeEach(() => {
    try {
      const { copyFileSync, existsSync } = require('node:fs');
      if (existsSync(MEMORY_PATH)) {
        hadExistingFile = true;
        copyFileSync(MEMORY_PATH, BACKUP_PATH);
      }
    } catch {}
  });

  afterEach(() => {
    try {
      if (hadExistingFile) {
        const { copyFileSync } = require('node:fs');
        copyFileSync(BACKUP_PATH, MEMORY_PATH);
        rmSync(BACKUP_PATH, { force: true });
      } else {
        rmSync(MEMORY_PATH, { force: true });
      }
    } catch {}
  });

  it('loadEngineMemory returns empty record when no file', () => {
    rmSync(MEMORY_PATH, { force: true });
    const record = loadEngineMemory();
    expect(record.engines).toEqual({});
  });

  it('addEngineNote creates profile and stores note', () => {
    rmSync(MEMORY_PATH, { force: true });
    addEngineNote('claude', 'bugfix', 'Fixed auth issue quickly');
    const profile = getEngineProfile('claude');
    expect(profile).not.toBeNull();
    expect(profile!.notes).toHaveLength(1);
    expect(profile!.notes[0].observation).toBe('Fixed auth issue quickly');
    expect(profile!.notes[0].taskClass).toBe('bugfix');
  });

  it('setEngineStrengths persists', () => {
    rmSync(MEMORY_PATH, { force: true });
    setEngineStrengths('codex', ['fast execution', 'good at refactoring']);
    const profile = getEngineProfile('codex');
    expect(profile!.strengths).toEqual(['fast execution', 'good at refactoring']);
  });

  it('setEngineWeaknesses persists', () => {
    rmSync(MEMORY_PATH, { force: true });
    setEngineWeaknesses('gemini', ['slow responses', 'misses edge cases']);
    const profile = getEngineProfile('gemini');
    expect(profile!.weaknesses).toEqual(['slow responses', 'misses edge cases']);
  });

  it('addEngineTendency deduplicates', () => {
    rmSync(MEMORY_PATH, { force: true });
    addEngineTendency('codex', 'over-engineers');
    addEngineTendency('codex', 'over-engineers');
    addEngineTendency('codex', 'good tests');
    const profile = getEngineProfile('codex');
    expect(profile!.tendencies).toEqual(['over-engineers', 'good tests']);
  });

  it('buildRolePrompt returns empty for unknown engine', () => {
    rmSync(MEMORY_PATH, { force: true });
    expect(buildRolePrompt('unknown-engine', 'bugfix')).toBe('');
  });

  it('buildRolePrompt includes strengths and notes', () => {
    rmSync(MEMORY_PATH, { force: true });
    setEngineStrengths('claude', ['architecture', 'debugging']);
    addEngineNote('claude', 'refactor', 'Clean refactoring approach');
    const prompt = buildRolePrompt('claude', 'refactor');
    expect(prompt).toContain('architecture');
    expect(prompt).toContain('Clean refactoring approach');
  });

  it('recordForgeOutcome logs winner and losers', () => {
    rmSync(MEMORY_PATH, { force: true });
    recordForgeOutcome('claude', ['codex', 'gemini'], 'feature', 'forge-123', 92, { codex: 78, gemini: 0 });

    const claudeProfile = getEngineProfile('claude');
    expect(claudeProfile!.notes.some(n => n.observation.includes('Won'))).toBe(true);

    const codexProfile = getEngineProfile('codex');
    expect(codexProfile!.notes.some(n => n.observation.includes('Lost'))).toBe(true);

    const geminiProfile = getEngineProfile('gemini');
    expect(geminiProfile!.notes.some(n => n.observation.includes('Failed'))).toBe(true);
  });

  it('caps notes at 50 per engine', () => {
    rmSync(MEMORY_PATH, { force: true });
    for (let i = 0; i < 60; i++) {
      addEngineNote('claude', 'bugfix', `Note ${i}`);
    }
    const profile = getEngineProfile('claude');
    expect(profile!.notes).toHaveLength(50);
    expect(profile!.notes[0].observation).toBe('Note 10'); // First 10 dropped
  });
});
