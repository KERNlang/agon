import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractFitnessCommandFromCesarOutput, inferProjectFitnessCommand } from '../../packages/cli/src/generated/handlers/forge.js';

describe('forge fitness preparation', () => {
  it('parses Cesar JSON fitness output', () => {
    const fitness = extractFitnessCommandFromCesarOutput(
      '{"fitnessCmd":"npm run test:ts -- tests/unit/forge-fitness-inference.test.ts","reason":"focused regression"}',
    );

    expect(fitness).toBe('npm run test:ts -- tests/unit/forge-fitness-inference.test.ts');
  });

  it('parses a plain one-line Cesar command', () => {
    expect(extractFitnessCommandFromCesarOutput('npm run typecheck')).toBe('npm run typecheck');
  });

  it('auto-selects a project fitness command instead of asking the user', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-forge-fitness-'));
    try {
      writeFileSync(join(dir, 'package.json'), JSON.stringify({ scripts: { typecheck: 'tsc -b' } }));
      expect(inferProjectFitnessCommand(dir)).toBe('npm run typecheck');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('falls back to a generic git diff check when no project test is detectable', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-forge-fitness-empty-'));
    try {
      expect(inferProjectFitnessCommand(dir)).toBe('git diff --check');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
