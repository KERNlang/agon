import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CommandContribution, IntentContribution, InvocationContext, ModServices } from '../../packages/mod-api/src/index.js';
import { ModRegistry } from '../../packages/mod-kernel/src/index.js';
import { resolveRegisteredModSettings } from '../../packages/mod-kernel/src/mod-settings.js';
import { createMod, MANIFEST } from '../../packages/mod-forge/src/index.js';
import { classifyNoDiffForgeResult as ownedNoDiffPolicy } from '@kernlang/agon-mod-forge';
import { DEFAULT_FIRST_PARTY_SETTINGS } from '../../packages/core/src/models/first-party-settings.generated.js';
import { DEFAULT_AGON_CONFIG } from '../../packages/core/src/models/types.js';
import { classifyNoDiffForgeResult } from '../../packages/forge/src/stages.js';

describe('Forge configuration ownership', () => {
  it('keeps the legacy classifier as the physical owner export', () => {
    expect(classifyNoDiffForgeResult).toBe(ownedNoDiffPolicy);
  });
  it.each(([
    { name: 'tool-loop exhaustion', mode: 'improve', requireDiff: false, acceptReviewOutput: true,
      stdout: 'API engine reached the 40-step tool loop limit after 40 tool calls; evaluating any candidate worktree changes with fitness.', pass: false },
    { name: 'short report with required diff', mode: 'validate', requireDiff: true, acceptReviewOutput: true,
      stdout: 'I reviewed the code.', pass: false },
    { name: 'explicitly accepted implementation report', mode: 'implement', requireDiff: true, acceptReviewOutput: true,
      stdout: 'The review covers module exports, use-from semantics, external boundaries, and test gaps; it recommends retaining the implementation because all checked behaviors pass.', pass: true },
    { name: 'baseline no-op without required diff', mode: 'improve', requireDiff: false, acceptReviewOutput: true,
      stdout: 'No changes needed.', pass: true },
    { name: 'baseline no-op with required diff', mode: 'validate', requireDiff: true, acceptReviewOutput: true,
      stdout: 'No changes needed.', pass: false },
    { name: 'failing fitness', mode: 'validate', requireDiff: false, acceptReviewOutput: true,
      stdout: 'I reviewed the code.', fitness: 'false', pass: false },
    { name: 'dispatch timeout', mode: 'validate', requireDiff: false, acceptReviewOutput: true,
      stdout: 'I reviewed the code.', exitCode: 124, timedOut: true, pass: false },
    { name: 'dispatch cancellation', mode: 'validate', requireDiff: false, acceptReviewOutput: true,
      stdout: 'I reviewed the code.', exitCode: 130, pass: false },
    { name: 'explicitly rejected implementation report', mode: 'implement', requireDiff: true, acceptReviewOutput: false,
      stdout: 'The review covers module exports, use-from semantics, external boundaries, and test gaps; it recommends retaining the implementation because all checked behaviors pass.', pass: false },
  ] as const).map(fixture => ({ fitness: 'true', exitCode: 0, timedOut: false, ...fixture })))('preserves legacy no-diff verdict: $name', async fixture => {
    const root = mkdtempSync(join(tmpdir(), 'agon-forge-no-diff-'));
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout;
    };
    const owner = { id: MANIFEST.id, version: MANIFEST.version, contentHash: `sha256:${'a'.repeat(64)}` as const };
    const registry = new ModRegistry({ generation: 'forge-no-diff-parity', activeOwners: [owner] });
    let dispatchCount = 0;
    try {
      git('init', '--quiet');
      writeFileSync(join(root, 'fixture.txt'), 'unchanged\n');
      git('add', 'fixture.txt');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'fixture');
      const session = registry.beginRegistration(MANIFEST);
      const mod = await createMod({
        engines: {
          listActive: async () => ['fixture'],
          dispatch: async () => { dispatchCount += 1; return { exitCode: fixture.exitCode, timedOut: fixture.timedOut, stdout: fixture.stdout, stderr: '' }; },
        },
        receipts: { record: async () => 'fixture-receipt' },
        logger: { debug: async () => {} },
      } as unknown as ModServices);
      await mod.activate(session.registrar);
      session.commit();
      const legacy = classifyNoDiffForgeResult({ ...fixture,
        fitnessPassed: fixture.fitness === 'true', baselinePasses: fixture.fitness === 'true' });
      expect(legacy.pass).toBe(fixture.pass);
      const command = registry.project('cli').entries[0]!.payload as CommandContribution;
      const result = await command.run({ task: 'inspect fixture', test: fixture.fitness, noHealthCheck: true,
        mode: fixture.mode, requireDiff: fixture.requireDiff, acceptReviewOutput: fixture.acceptReviewOutput }, {
        invocationId: 'forge-no-diff-parity', cwd: root, platform: 'darwin-arm64', signal: new AbortController().signal, config: {},
      });
      expect(dispatchCount).toBe(1);
      expect(result).toMatchObject({ exitCode: fixture.pass ? 0 : 1, result: {
        winner: fixture.pass ? 'fixture' : null, candidates: [{ ...legacy, diffLines: 0 }],
      } });
      expect(git('status', '--porcelain')).toBe('');
      expect(git('worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
    } finally {
      await registry.disposeOwner(owner.id);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each(['npm test', 'false', 'node check.mjs'])('preserves the intent fitness command through physical execution: %s', async fitness => {
    const owner = { id: MANIFEST.id, version: MANIFEST.version, contentHash: `sha256:${'a'.repeat(64)}` as const };
    const registry = new ModRegistry({ generation: 'forge-input-parity', activeOwners: [owner] });
    const session = registry.beginRegistration(MANIFEST);
    const mod = await createMod({ engines: {
      listActive: async () => ['fixture'],
      dispatch: async () => { throw new Error('dry-run must not dispatch'); },
    } } as unknown as ModServices);
    await mod.activate(session.registrar);
    session.commit();
    try {
      const intent = registry.resolve('intent', 'intentVariants:0032')!.payload as IntentContribution;
      const parsed = await intent.parse(`/forge fix the defect test with ${fitness}`);
      expect(parsed).toMatchObject({ fitnessCmd: fitness });
      const context: InvocationContext = { invocationId: 'forge-input-parity', cwd: '/fixture', platform: 'darwin-arm64',
        signal: new AbortController().signal, config: {} };
      const result = await intent.run({ ...(parsed as object), dryRun: true, noHealthCheck: true }, context);
      expect(result).toMatchObject({ exitCode: 0, result: { fitness, fitnessProvided: true } });
      const command = registry.project('cli').entries[0]!.payload as CommandContribution;
      expect(await command.run({ task: 'fixture', test: fitness, dryRun: true, noHealthCheck: true }, context))
        .toMatchObject({ exitCode: 0, result: { fitness, fitnessProvided: true } });
      expect(await command.run({ task: 'fixture', test: fitness, fitnessCmd: 'ignored compatibility value', dryRun: true, noHealthCheck: true }, context))
        .toMatchObject({ exitCode: 0, result: { fitness, fitnessProvided: true } });
    } finally { await registry.disposeOwner(owner.id); }
  });

  it.each(['false', 'true', 'printf generated > generated.txt'])('executes the parsed fitness command in real worktrees: %s', async fitness => {
    const root = mkdtempSync(join(tmpdir(), 'agon-forge-fitness-'));
    const git = (...args: string[]) => {
      const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
      return result.stdout;
    };
    const owner = { id: MANIFEST.id, version: MANIFEST.version, contentHash: `sha256:${'a'.repeat(64)}` as const };
    const registry = new ModRegistry({ generation: 'forge-fitness-runtime', activeOwners: [owner] });
    const contexts: string[] = [];
    const cleanups: Array<{ rootPath: string; cleanupComplete: boolean }> = [];
    try {
      git('init', '--quiet');
      writeFileSync(join(root, 'fixture.txt'), 'before\n');
      git('add', 'fixture.txt');
      git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '--quiet', '-m', 'fixture');
      const session = registry.beginRegistration(MANIFEST);
      const mod = await createMod({
        engines: {
          listActive: async () => ['fixture'],
          dispatch: async (_engine: string, prompt: string, context: InvocationContext) => {
            expect(prompt).toContain(`FITNESS COMMAND: ${fitness}\n`);
            contexts.push(context.cwd);
            expect(context.cwd).not.toBe(root);
            writeFileSync(join(context.cwd, 'fixture.txt'), 'after\n');
            return { exitCode: 0, stdout: 'fixture implementation', stderr: '' };
          },
        },
        receipts: { record: async () => 'fixture-receipt' },
        logger: { debug: async (_message: string, fields: { rootPath: string; cleanupComplete: boolean }) => { cleanups.push(fields); } },
      } as unknown as ModServices);
      await mod.activate(session.registrar);
      session.commit();
      const intent = registry.resolve('intent', 'intentVariants:0032')!.payload as IntentContribution;
      const parsed = await intent.parse(`/forge change fixture test with ${fitness}`);
      const result = await intent.run({ ...(parsed as object), noHealthCheck: true }, {
        invocationId: 'forge-fitness-runtime', cwd: root, platform: 'darwin-arm64',
        signal: new AbortController().signal, config: {},
      });
      const passes = fitness !== 'false';
      const generatesFile = fitness.includes('generated.txt');
      expect(result).toMatchObject({ exitCode: passes ? 0 : 1, result: {
        fitness, fitnessProvided: true, winner: passes ? 'fixture' : null,
        status: passes ? 'winner' : 'no_passing_candidate',
        baseline: { command: fitness, exitCode: passes ? 0 : 1 },
        candidates: [{ fitnessPassed: passes, pass: passes, filesChanged: generatesFile ? 2 : 1 }],
      } });
      if (generatesFile) {
        expect(result.result).toMatchObject({ winningPatch: expect.stringContaining('+generated') });
      }
      expect(contexts).toHaveLength(1);
      expect(cleanups).toHaveLength(1);
      expect(cleanups[0].cleanupComplete).toBe(true);
      expect(existsSync(cleanups[0].rootPath)).toBe(false);
      expect(readFileSync(join(root, 'fixture.txt'), 'utf8')).toBe('before\n');
      expect(git('status', '--porcelain')).toBe('');
      expect(git('worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
    } finally {
      await registry.disposeOwner(owner.id);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('validates migration metadata without allowing unknown value-schema keywords', () => {
    const base = { type: 'object', properties: { enabled: { type: 'boolean', default: true } } };
    const resolve = (schema: object) => resolveRegisteredModSettings('example.settings', {}, [schema]);
    expect(resolve({ ...base, 'x-agon-config': { version: 1, legacyAliases: ['enabled'] } })).toEqual({ enabled: true });
    for (const descriptor of [null, { version: 2, legacyAliases: [] }, { version: 1, legacyAliases: ['enabled', 'enabled'] },
      { version: 1, legacyAliases: ['constructor'] }, { version: 1, legacyAliases: ['unknown'] }, { version: 1, legacyAliases: [], run: 'code' }]) {
      expect(() => resolve({ ...base, 'x-agon-config': descriptor })).toThrow(/descriptor|alias/);
    }
    expect(() => resolve({ ...base, 'x-unknown': {} })).toThrow(/unsupported schema keyword/);
  });
  it('keeps mutable compatibility defaults independent of generated defaults', () => {
    const compatibility = DEFAULT_AGON_CONFIG.goalReviewEngines;
    const generated = DEFAULT_FIRST_PARTY_SETTINGS.goalReviewEngines;
    expect(compatibility).not.toBe(generated);
    const before = [...generated];
    try {
      generated.push('fixture-mutation');
      expect(compatibility).not.toContain('fixture-mutation');
    } finally { generated.splice(0, generated.length, ...before); }
  });
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
    expect(DEFAULT_FIRST_PARTY_SETTINGS).toMatchObject(Object.fromEntries(
      Object.entries(schema.properties as Record<string, { default: unknown }>).map(([key, property]) => [key, property.default]),
    ));
  });

  it.each([
    ['review', () => import('../../packages/mod-review/src/index.js'), { autoReviewAfterImpl: true, goalReviewEngines: [] }],
    ['agent', () => import('../../packages/mod-agent/src/index.js'), { cesarAgenticContinuationLimit: 12 }],
    ['mutate', () => import('../../packages/mod-mutate/src/index.js'), { cesarMutateReflex: true }],
    ['synthesis', () => import('../../packages/mod-synthesis/src/index.js'), { forgeEnableSynthesis: false, forgeSynthesisTimeout: 300, skillSynthesisThreshold: 3 }],
  ] as const)('%s owns and registers its configuration', async (name, load, expected) => {
    const { MANIFEST: declaration, createMod: factory } = await load();
    const owner = { id: declaration.id, version: declaration.version, contentHash: `sha256:${'a'.repeat(64)}` as const };
    const registry = new ModRegistry({ generation: 'remaining-settings', activeOwners: [owner] });
    const session = registry.beginRegistration(declaration);
    const mod = await factory(new Proxy({} as ModServices, { get() { throw new Error('unexpected host effect'); } }));
    await mod.activate(session.registrar);
    session.commit();
    const schema = JSON.parse(readFileSync(new URL(`../../packages/mod-${name}/schemas/config.schema.json`, import.meta.url), 'utf8'));
    const schemas = declaration.contributes.configKeys.map(({ id }) => registry.resolve('config', id)!.payload);
    const { $id: _schemaId, ...registeredSchema } = schema;
    for (const payload of schemas) expect(payload).toEqual(registeredSchema);
    expect(Object.keys(schema.properties ?? {}).sort()).toEqual(Object.keys(expected).sort());
    expect(resolveRegisteredModSettings(owner.id, {}, schemas)).toEqual(expected);
    const explicit = Object.fromEntries(Object.entries(expected).map(([key, value]) => [key, Array.isArray(value) ? ['fixture-engine'] : typeof value === 'boolean' ? false : 0]));
    expect(resolveRegisteredModSettings(owner.id, { ...explicit, future: 'keep' }, schemas)).toEqual({ ...explicit, future: 'keep' });
    const command = (registry.project('cli').entries[0] ?? registry.project('tui').entries[0]).payload as CommandContribution;
    const context: InvocationContext = { invocationId: 'remaining-invalid', cwd: '/fixture', platform: 'darwin-arm64', signal: new AbortController().signal, config: { [Object.keys(expected)[0]]: null } };
    expect(() => command.run({}, context)).toThrow(/mod settings for agon\./);
    for (const key of Object.keys(expected)) {
      expect(() => command.run({}, { ...context, config: { [key]: null } })).toThrow(/mod settings for agon\./);
    }
    if (name === 'review') {
      expect(() => command.run({}, { ...context, config: { goalReviewEngines: ['valid', 3] } })).toThrow(/mod settings/);
      const first = resolveRegisteredModSettings(owner.id, {}, schemas).goalReviewEngines;
      const second = resolveRegisteredModSettings(owner.id, {}, schemas).goalReviewEngines;
      expect(first).not.toBe(second);
      expect(first).not.toBe(schema.properties.goalReviewEngines.default);
      expect(Object.isFrozen(first)).toBe(true);
    }
    await registry.disposeOwner(owner.id);
    expect(() => command.run({}, { ...context, config: {} })).toThrow(/unavailable/);
  });

  it('generates exactly the defaults assigned to the five mod owners', () => {
    const ledger = JSON.parse(readFileSync(new URL('../../docs/specs/evidence/modular-agon-ownership.json', import.meta.url), 'utf8'));
    const expected: Record<string, unknown> = {};
    for (const name of ['forge', 'review', 'agent', 'mutate', 'synthesis']) {
      const schema = JSON.parse(readFileSync(new URL(`../../packages/mod-${name}/schemas/config.schema.json`, import.meta.url), 'utf8'));
      const keys = ledger.assignments.filter((item: { category: string; package: string }) => item.category === 'configKeys' && item.package === `@kernlang/agon-mod-${name}`)
        .map((item: { id: string }) => item.id).sort();
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(keys);
      for (const key of keys) expected[key] = schema.properties[key].default;
    }
    expect(DEFAULT_FIRST_PARTY_SETTINGS).toEqual(expected);
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
      for (const aliases of [[], ['forgeFitnessTimeout'], ['forgeFitnessTimeout', 'forgeFitnessTimeout'], ['foreignSetting']]) {
        writeFileSync(schemaPath, JSON.stringify({ ...schema, 'x-agon-config': { version: 1, legacyAliases: aliases } }));
        const invalid = run();
        expect(invalid.status).toBe(1);
        expect(invalid.stderr).toContain('legacy migration aliases differ');
      }
      writeFileSync(schemaPath, JSON.stringify(schema));
      const generatedPath = join(fixture, 'packages/core/src/models/first-party-settings.generated.ts');
      const generated = readFileSync(generatedPath, 'utf8');
      expect(generated).not.toMatch(/foreignSetting|not-forge-owned/);
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
      ledger.assignments.pop();
      const assignment = ledger.assignments.find((item: { category: string; id: string }) => item.category === 'configKeys' && item.id === 'forgeFitnessTimeout');
      ledger.assignments.push({ ...assignment, package: '@kernlang/agon-mod-review' });
      writeFileSync(ledgerPath, JSON.stringify(ledger));
      const reviewPath = join(fixture, 'packages/mod-review/schemas/config.schema.json');
      const reviewSchema = JSON.parse(readFileSync(reviewPath, 'utf8'));
      reviewSchema.properties = { ...reviewSchema.properties, forgeFitnessTimeout: { type: 'number', default: 120 } };
      writeFileSync(reviewPath, JSON.stringify(reviewSchema));
      const crossOwner = run();
      expect(crossOwner.status).toBe(1);
      expect(crossOwner.stderr).toContain('duplicate settings owner');
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });
});
