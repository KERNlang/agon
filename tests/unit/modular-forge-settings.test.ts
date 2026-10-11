import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CommandContribution, InvocationContext, ModServices } from '../../packages/mod-api/src/index.js';
import { ModRegistry } from '../../packages/mod-kernel/src/index.js';
import { resolveRegisteredModSettings } from '../../packages/mod-kernel/src/mod-settings.js';
import { createMod, MANIFEST } from '../../packages/mod-forge/src/index.js';
import { DEFAULT_FIRST_PARTY_SETTINGS } from '../../packages/core/src/models/first-party-settings.generated.js';

describe('Forge configuration ownership', () => {
  it('ships its assigned defaults in the owner schema', () => {
    const schema = JSON.parse(readFileSync(new URL('../../packages/mod-forge/schemas/config.schema.json', import.meta.url), 'utf8'));
    const ledger = JSON.parse(readFileSync(new URL('../../docs/specs/evidence/modular-agon-ownership.json', import.meta.url), 'utf8'));
    const keys = ledger.assignments.filter((item: { category: string; package: string }) => item.category === 'configKeys' && item.package === '@kernlang/agon-mod-forge')
      .map((item: { id: string }) => item.id).sort();
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(keys);
    expect(schema.properties).toEqual({
      autoReviewAfterForge: { type: 'boolean', default: true },
      forgeFitnessTimeout: { type: 'number', default: 120 },
    });
    expect(DEFAULT_FIRST_PARTY_SETTINGS).toEqual(Object.fromEntries(
      Object.entries(schema.properties as Record<string, { default: unknown }>).map(([key, property]) => [key, property.default]),
    ));
  });

  it('registers executable defaults and rejects invalid settings before effects', async () => {
    const owner = { id: MANIFEST.id, version: MANIFEST.version, contentHash: `sha256:${'a'.repeat(64)}` as const };
    const registry = new ModRegistry({ generation: 'forge-settings', activeOwners: [owner] });
    const session = registry.beginRegistration(MANIFEST);
    // Activation must only register contributions, not use host effects.
    const mod = await createMod(new Proxy({} as ModServices, { get() { throw new Error('unexpected host effect'); } }));
    await mod.activate(session.registrar);
    session.commit();
    const schemas = MANIFEST.contributes.configKeys.map(({ id }) => registry.resolve('config', id)!.payload);
    expect(resolveRegisteredModSettings(owner.id, {}, schemas)).toEqual({ autoReviewAfterForge: true, forgeFitnessTimeout: 120 });
    expect(resolveRegisteredModSettings(owner.id, { autoReviewAfterForge: false, forgeFitnessTimeout: 0, future: 'keep' }, schemas))
      .toEqual({ autoReviewAfterForge: false, forgeFitnessTimeout: 0, future: 'keep' });
    const command = registry.project('cli').entries[0].payload as CommandContribution;
    const context: InvocationContext = { invocationId: 'forge-invalid', cwd: '/fixture', platform: 'darwin-arm64', signal: new AbortController().signal, config: {} };
    for (const config of [{ forgeFitnessTimeout: 'wrong' }, { forgeFitnessTimeout: null }, { forgeFitnessTimeout: Infinity }, { autoReviewAfterForge: 'false' }]) {
      expect(() => command.run({}, { ...context, config })).toThrow(/mod settings for agon.forge/);
    }
    for (const schema of schemas) expect(schema).not.toHaveProperty('$id');
    await registry.disposeOwner(owner.id);
    expect(() => command.run({}, { ...context, config: {} })).toThrow(/unavailable/);
  });

  it('generates from owner inputs, rejects invalid definitions and detects stale output', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const fixture = mkdtempSync(join(tmpdir(), 'forge-settings-generator-'));
    try {
      const inputs = ['scripts/spec/generate-modular-first-party-packages.mjs', 'LICENSE', 'package.json', 'tsconfig.json',
        ...['package-map', 'ownership', 'current-inventory', 'ui-hierarchy', 'physical-contributions'].map(name => `docs/specs/evidence/modular-agon-${name}.json`)];
      const packages = JSON.parse(readFileSync(join(root, inputs[4]), 'utf8')).packages as { id: string; class: string }[];
      for (const pkg of packages.filter(item => item.class === 'user-toggleable-mod-package')) {
        const path = `packages/${pkg.id.replace('@kernlang/agon-', '')}`;
        inputs.push(`${path}/schemas/config.schema.json`);
        if (existsSync(join(root, path, 'src/implementation.ts'))) inputs.push(`${path}/src/implementation.ts`);
      }
      for (const input of inputs) {
        mkdirSync(dirname(join(fixture, input)), { recursive: true });
        cpSync(join(root, input), join(fixture, input));
      }
      const run = (check = false) => spawnSync(process.execPath, [join(fixture, inputs[0]), ...(check ? ['--check'] : [])], { cwd: fixture, encoding: 'utf8' });
      const schemaPath = join(fixture, 'packages/mod-forge/schemas/config.schema.json');
      const originalSchema = readFileSync(schemaPath, 'utf8');
      const schema = JSON.parse(originalSchema);
      schema.properties.foreignSetting = { type: 'string', default: 'ignored' };
      schema.properties.goalReviewEngines = { type: 'array', items: { type: 'string' }, default: ['not-forge-owned'] };
      writeFileSync(schemaPath, JSON.stringify(schema));
      expect(run().status).toBe(0);
      expect(run(true).status).toBe(0);
      const generatedPath = join(fixture, 'packages/core/src/models/first-party-settings.generated.ts');
      const generated = readFileSync(generatedPath, 'utf8');
      expect(generated).not.toMatch(/foreignSetting|goalReviewEngines/);
      expect(generated).toContain('forgeFitnessTimeout?: number');
      expect(generated).toContain('autoReviewAfterForge?: boolean');
      schema.properties.forgeFitnessTimeout.default = 121;
      const changedSchema = JSON.stringify(schema);
      writeFileSync(schemaPath, changedSchema);
      expect(run(true).status).toBe(1);
      expect(run().status).toBe(0);
      expect(readFileSync(schemaPath, 'utf8')).toBe(changedSchema);
      expect(readFileSync(generatedPath, 'utf8')).toContain('"forgeFitnessTimeout": 121');
      expect(run(true).status).toBe(0);
      for (const invalid of [null, false, { type: 'number' }, { type: 'object', default: {} }, { type: 'number', default: 'wrong' }]) {
        schema.properties.forgeFitnessTimeout = invalid;
        writeFileSync(schemaPath, JSON.stringify(schema));
        expect(run().status).toBe(1);
      }
      writeFileSync(schemaPath, originalSchema);
      const ledgerPath = join(fixture, 'docs/specs/evidence/modular-agon-ownership.json');
      const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
      ledger.assignments.push(ledger.assignments.find((item: { category: string; id: string }) => item.category === 'configKeys' && item.id === 'forgeFitnessTimeout'));
      writeFileSync(ledgerPath, JSON.stringify(ledger));
      const duplicate = run();
      expect(duplicate.status).toBe(1);
      expect(duplicate.stderr).toContain('duplicate settings owner');
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });
});
