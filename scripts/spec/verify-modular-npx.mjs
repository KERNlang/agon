import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { verifyPackedMcp } from './verify-packed-mcp.mjs';
import { verifyPackedBrainstorm } from './verify-packed-brainstorm.mjs';
import { verifyPackedBrainstormTui } from './verify-packed-brainstorm-tui.mjs';
import { verifyPackedSynthesis } from './verify-packed-synthesis.mjs';
import { createFrozenNpmInstall, createNpmReleaseCatalog, DurableModHost, ManagedLifecycleService, hashInstalledPackagePayload } from '../../packages/mod-kernel/dist/index.js';

const root = resolve(import.meta.dirname, '../..');
const output = join(root, 'docs/specs/evidence/modular-agon-npx-qualification.json');
const release = JSON.parse(readFileSync(join(root, 'docs/specs/evidence/modular-agon-release-set.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'agon-s9-npx-'));
const packRoot = join(scratch, 'tarballs');
const ephemeral = join(scratch, 'ephemeral-npx-cache');
const home = join(scratch, 'Agon Home ü with spaces');
const npmCache = process.env.AGON_S9_NPM_CACHE || '/private/tmp/agon-s8-npm-cache-ba8c411f';
const checks = [];
const run = (executable, args, options = {}) => spawnSync(executable, args, { cwd: options.cwd ?? root, encoding: 'utf8', timeout: options.timeout ?? 15 * 60_000,
  env: { ...process.env, npm_config_ignore_scripts: 'true', npm_config_cache: npmCache, npm_config_logs_dir: join(scratch, 'npm-logs'), ...options.env } });
const requireOk = (id, result) => {
  const passed = result.status === 0 && !result.error && !result.signal;
  checks.push({ id, passed, detail: passed ? 'exit=0' : `exit=${result.status} signal=${result.signal ?? 'none'} error=${result.error ?? ''} stderr=${String(result.stderr).slice(0, 1200)}` });
  if (!passed) throw new Error(checks.at(-1).detail);
  return result;
};
const makeRemovable = (path) => {
  if (!existsSync(path)) return;
  try { chmodSync(path, 0o700); } catch { /* rmSync reports unrecoverable permissions */ }
  for (const entry of readdirSync(path)) {
    const child = join(path, entry);
    try {
      const info = lstatSync(child);
      // chmod follows symlinks: applying file permissions to a linked run
      // directory removes traversal permission and makes cleanup fail.
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) makeRemovable(child);
      else chmodSync(child, 0o600);
    } catch { /* rmSync reports unrecoverable permissions */ }
  }
};

mkdirSync(packRoot, { recursive: true });
try {
  const tarballs = {};
  const artifacts = {};
  for (const pkg of [...release.packages, ...release.compatibilityArtifacts]) {
    const result = requireOk(`pack:${pkg.id}`, run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packRoot], { cwd: join(root, pkg.directory) }));
    const packed = JSON.parse(result.stdout)[0];
    tarballs[pkg.id] = join(packRoot, packed.filename);
    artifacts[pkg.id] = { version: pkg.version, resolved: `file:${tarballs[pkg.id]}`, integrity: packed.integrity };
  }
  const cliPack = requireOk('pack:@kernlang/agon', run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packRoot], { cwd: join(root, 'packages/cli') }));
  const launcherTarball = join(packRoot, JSON.parse(cliPack.stdout)[0].filename);
  artifacts['@kernlang/agon'] = { version: release.version, resolved: `file:${launcherTarball}`, integrity: JSON.parse(cliPack.stdout)[0].integrity };
  mkdirSync(ephemeral, { recursive: true });
  const channel = JSON.parse(readFileSync(join(root, 'packages/cli/release-channel.json'), 'utf8'));
  const frozen = createFrozenNpmInstall(channel.npmCatalog, Object.keys(artifacts), artifacts);
  writeFileSync(join(ephemeral, 'package.json'), JSON.stringify(frozen.manifest, null, 2));
  const lockBytes = JSON.stringify(frozen.lock, null, 2);
  writeFileSync(join(ephemeral, 'package-lock.json'), lockBytes);
  requireOk('ephemeral-npx-hydration', run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=optional', '--offline'], { cwd: ephemeral }));
  if (readFileSync(join(ephemeral, 'package-lock.json'), 'utf8') !== lockBytes) throw new Error('packed hydration changed the frozen dependency lock');
  requireOk('packed-nero-text-only', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import { runNero } from '@kernlang/agon-mod-nero';
    assert.ok(import.meta.resolve('@kernlang/agon-mod-nero').startsWith(pathToFileURL(process.cwd() + '/node_modules/').href));
    const calls = [];
    const services = {
      engines: { listActive: async () => ['first', 'second'], dispatch: async (engine, _prompt, _context, options) => {
        calls.push({ engine, textOnly: options?.textOnly });
        return { exitCode: 0, stdout: engine === 'first' ? '' : 'Confidence: 80%\\nVERDICT: SOUND' };
      } },
      receipts: { record: async () => 'fixture-receipt' },
    };
    const context = { invocationId: 'text-only', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {} };
    const result = await runNero({ decision: 'Ship now' }, context, services);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(calls, [{ engine: 'first', textOnly: true }, { engine: 'first', textOnly: true }, { engine: 'second', textOnly: true }]);
  `], { cwd: ephemeral }));
  requireOk('packed-naturalize-text-only', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import { runNaturalize } from '@kernlang/agon-mod-naturalize';
    assert.ok(import.meta.resolve('@kernlang/agon-mod-naturalize').startsWith(pathToFileURL(process.cwd() + '/node_modules/').href));
    const flags = [];
    const services = {
      engines: { listActive: async () => ['fixture'], dispatch: async (_engine, _prompt, _context, options) => {
        flags.push(options?.textOnly);
        return flags.length === 1 ? { exitCode: 1, stdout: '' } : { exitCode: 0, stdout: 'Rewritten plain prose.' };
      } },
      receipts: { record: async () => 'fixture-receipt' },
    };
    const context = { invocationId: 'text-only', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {} };
    const result = await runNaturalize({ text: 'Original plain prose.', engine: 'fixture', maxAttempts: 2 }, context, services);
    assert.equal(result.exitCode, 0);
    assert.deepEqual(flags, [true, true]);
  `], { cwd: ephemeral }));
  requireOk('packed-research-prompt-pure-import', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { register } from 'node:module';
    register('data:text/javascript,' + encodeURIComponent(
      "export async function resolve(id, context, next) { if (['undici', 'node:dns/promises', 'node:net'].includes(id)) throw new Error('blocked network import: ' + id); return next(id, context); }"
    ));
    const { buildResearchPrompt, buildPrompt } = await import('@kernlang/agon-mod-research/prompt-policy');
    assert.match(buildResearchPrompt('Question', []), /QUESTION:/);
    assert.match(buildPrompt('Question', []), /QUESTION:/);
    await assert.rejects(import('@kernlang/agon-mod-research'), /blocked network import/);
  `], { cwd: ephemeral }));
  requireOk('compiled-forge-research-prompt-owner', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { buildResearchPrompt as legacy } from ${JSON.stringify(join(root, 'packages/forge/dist/index.js'))};
    import { buildResearchPrompt as owner } from '@kernlang/agon-mod-research/prompt-policy';
    assert.equal(legacy, owner);
  `]));
  requireOk('packed-research-prompt-owner', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import * as physical from '@kernlang/agon-mod-research';
    import { buildResearchPrompt, buildPrompt } from '@kernlang/agon-mod-research/prompt-policy';
    assert.ok(import.meta.resolve('@kernlang/agon-mod-research/prompt-policy').startsWith(pathToFileURL(process.cwd() + '/node_modules/').href));
    assert.equal(physical.buildResearchPrompt, buildResearchPrompt);
    assert.equal(physical.buildPrompt, buildPrompt);
    const source = { title: '', url: 'https://example.org', content: '  ', snippet: ' two\\n words ', fetched: true };
    assert.equal(buildResearchPrompt('  Question?  ', [source]), [
      'You are a careful research assistant. Answer the QUESTION using ONLY the SOURCES below.',
      'Do NOT use prior knowledge or invent facts or URLs. If the sources do not answer the question, say so plainly.',
      '', 'QUESTION:', 'Question?', '', 'SOURCES:',
      '[1] https://example.org', '    https://example.org', '    two words', '', 'INSTRUCTIONS:',
      '1. Answer the question directly and concisely, grounded in the sources.',
      '2. Cite every claim inline with the source number in brackets, e.g. [1], [2].',
      '3. Do not cite a source you did not use; do not invent sources or URLs.',
      '4. End with a "Sources:" section listing each [n] and its URL.'
    ].join('\\n'));
    assert.equal(buildPrompt('  Question?  ', [source]), [
      'Answer the QUESTION using ONLY the numbered SOURCES. Cite every factual claim inline as [n]. Never invent URLs or facts. If evidence is insufficient, say so.',
      '', 'QUESTION:', '  Question?  ', '', 'SOURCES:', '[1] ', 'https://example.org', '  '
    ].join('\\n'));
  `], { cwd: ephemeral }));
  const researchPromptTypes = join(ephemeral, 'research-prompt-types.mts');
  writeFileSync(researchPromptTypes, `import { buildResearchPrompt, buildPrompt, type Source } from '@kernlang/agon-mod-research/prompt-policy';
    import { buildResearchPrompt as rootPrompt, buildPrompt as rootPhysical } from '@kernlang/agon-mod-research';
    import { buildResearchPrompt as legacy } from ${JSON.stringify(join(root, 'packages/forge/dist/research.js'))};
    import type { Source as PreviousSource } from ${JSON.stringify(join(root, 'packages/mod-research/dist/implementation.js'))};
    const source: Source = { title: 'Doc', url: 'https://example.org', snippet: 'body', fetched: true };
    const previous: PreviousSource = source;
    for (const build of [buildResearchPrompt, rootPrompt, legacy]) {
      const output: string = build('Question', [{ title: 'Doc', url: 'https://example.org' }]);
      void output;
      // @ts-expect-error Source URLs must remain strings.
      build('Question', [{ title: 'Doc', url: 1 }]);
    }
    for (const build of [buildPrompt, rootPhysical]) {
      const output: string = build('Question', [previous]);
      void output;
      // @ts-expect-error The physical source contract retains fetched.
      build('Question', [{ title: 'Doc', url: 'https://example.org', snippet: 'body' }]);
    }
  `);
  requireOk('packed-research-prompt-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--target', 'ES2022', researchPromptTypes], { cwd: ephemeral }));
  requireOk('packed-research-format-pure-import', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { register } from 'node:module';
    register('data:text/javascript,' + encodeURIComponent(
      "export async function resolve(id, context, next) { if (['undici', 'node:dns/promises', 'node:net'].includes(id)) throw new Error('blocked network import: ' + id); return next(id, context); }"
    ));
    const { formatResearchResult } = await import('@kernlang/agon-mod-research/format-policy');
    assert.equal(formatResearchResult({ ok: false, note: 'fixture' }), 'Research produced no grounded answer — fixture');
    await assert.rejects(import('@kernlang/agon-mod-research'), /blocked network import/);
  `], { cwd: ephemeral }));
  requireOk('compiled-forge-research-format-owner', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { formatResearchResult as legacy } from ${JSON.stringify(join(root, 'packages/forge/dist/index.js'))};
    import { formatResearchResult as owner } from '@kernlang/agon-mod-research/format-policy';
    assert.equal(legacy, owner);
  `]));
  requireOk('packed-research-format-owner', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import { formatResearchResult as physical } from '@kernlang/agon-mod-research';
    import { formatResearchResult as owner } from '@kernlang/agon-mod-research/format-policy';
    assert.ok(import.meta.resolve('@kernlang/agon-mod-research/format-policy').startsWith(pathToFileURL(process.cwd() + '/node_modules/').href));
    assert.equal(physical, owner);
    const result = { ok: true, answer: 'Claim [1].', intent: 'standard', engineId: 'fixture',
      sources: [{ title: 'Doc', url: 'https://source.example' }],
      citations: { total: 2, verified: 1, blocked: 1, results: [
        { url: 'https://source.example', verdict: 'verified', detail: 'HTTP 200' },
        { url: 'https://blocked.example', verdict: 'blocked', detail: 'HTTP 403' }
      ] }
    };
    const output = owner(result);
    assert.match(output, /1\\/2 verified · 1 blocked/);
    assert.match(output, /Could not verify/);
    assert.doesNotMatch(output, /Unverified citations/);
    assert.equal(output, [
      'Claim [1].', '', 'Sources (1) · citations 1/2 verified · 1 blocked · standard · engine fixture',
      '  [1] Doc', '      https://source.example', '',
      'ⓘ Could not verify (host blocked our re-fetch — citation not disproven):',
      '  ⚠ [blocked] https://blocked.example — HTTP 403'
    ].join('\\n'));
    assert.equal(owner({ ...result, ok: false, note: 'no evidence' }), 'Research produced no grounded answer — no evidence');
  `], { cwd: ephemeral }));
  requireOk('packed-research-address-guard', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import dns from 'node:dns/promises';
    import { syncBuiltinESMExports } from 'node:module';
    import { pathToFileURL } from 'node:url';
    let address = '::ffff:7f00:1';
    dns.lookup = async () => [{ address, family: 6 }];
    syncBuiltinESMExports();
    const { runResearch } = await import('@kernlang/agon-mod-research');
    assert.ok(import.meta.resolve('@kernlang/agon-mod-research').startsWith(pathToFileURL(process.cwd() + '/node_modules/').href));
    const context = { invocationId: 'packed-research', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {} };
    const services = { permissions: { check: async () => 'allow' }, receipts: { record: async () => 'fixture-receipt' }, engines: {
      listActive: async () => ['fixture'], dispatch: async () => ({ exitCode: 0, stdout: 'Supported claim [1].' })
    } };
    for (const candidate of ['::ffff:7f00:1', '0:0:0:0:0:ffff:7f00:1', '::ffff:a00:1', '0:0:0:0:0:0:0:1', '::ffff:808:808']) {
      address = candidate;
      let calls = 0;
      globalThis.fetch = async (input) => {
        calls++;
        return new Response(String(input).startsWith('https://registry.npmjs.org/')
          ? JSON.stringify({ objects: [{ package: { name: 'pkg', links: { npm: 'https://source.example/pkg' } } }] })
          : 'Evidence', { status: 200 });
      };
      const result = await runResearch({ question: 'npm package pkg' }, context, services);
      const allowed = candidate === '::ffff:808:808';
      assert.equal(calls, allowed ? 3 : 1, candidate);
      assert.equal(result.exitCode, allowed ? 0 : 1, candidate);
      assert.equal(result.result.citations.verified, allowed ? 1 : 0, candidate);
    }
  `], { cwd: ephemeral }));
  requireOk('packed-agent-team-scoring-owner', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import { scoreAgentTeamResult } from '@kernlang/agon-mod-agent';
    assert.ok(import.meta.resolve('@kernlang/agon-mod-agent').startsWith(pathToFileURL(process.cwd() + '/node_modules/').href));
    const team = { members: [{ engineId: 'worker', worktreePath: '/fixture', error: null,
      stepResult: { response: 'x'.repeat(51), toolCalls: 1, innerSteps: 1, tokensUsed: 2, costUsd: 0, stopReason: 'completed' }
    }], runId: 'fixture', baseSha: 'base', durationMs: 1500, succeeded: 1, failed: 0 };
    const read = (cwd, base) => { assert.equal(cwd, '/fixture'); assert.equal(base, 'base'); return { filesChanged: 1, linesChanged: 2 }; };
    assert.equal(scoreAgentTeamResult(team, 'edit', undefined, read).get('worker').pass, false);
    const result = scoreAgentTeamResult(team, 'edit', new Map([['worker', true]]), read).get('worker');
    assert.equal(result.pass, true); assert.equal(result.score, 100); assert.equal(result.durationSec, 2);
    assert.equal(scoreAgentTeamResult(team, 'investigate', undefined, () => { throw new Error('unexpected Git read'); }).get('worker').pass, true);
  `], { cwd: ephemeral }));
  const researchFormatTypes = join(ephemeral, 'research-format-types.mts');
  writeFileSync(researchFormatTypes, `import { formatResearchResult, type ResearchFormatInput } from '@kernlang/agon-mod-research/format-policy';
    import { formatResearchResult as physical } from '@kernlang/agon-mod-research';
    import { formatResearchResult as legacyFormat } from ${JSON.stringify(join(root, 'packages/forge/dist/research.js'))};
    import type { ResearchResult } from ${JSON.stringify(join(root, 'packages/forge/dist/research.js'))};
    declare const legacy: ResearchResult;
    const compatible: ResearchFormatInput = legacy;
    const rendered: string = formatResearchResult(compatible);
    void rendered;
    for (const format of [formatResearchResult, physical, legacyFormat]) {
      format({ ok: true, question: 'q', outputDir: '/fixture', answer: 'Claim [1].', intent: 'general', engineId: 'fixture',
        sources: [{ title: 'Doc', url: 'https://source.example', snippet: 'snippet', fetched: true, content: 'content' }],
        citations: { total: 1, verified: 1, blocked: 0, rejected: 0, invalidNumbers: [], results: [
          { url: 'https://source.example', verdict: 'verified', detail: 'ok', httpStatus: 200, finalUrl: 'https://source.example' }
        ] }
      });
      format({ ok: false, question: 'q', intent: 'general', engineId: '', answer: '', sources: [],
        citations: { total: 0, verified: 0, blocked: 0, rejected: 0, results: [] }, outputDir: '/fixture', note: 'no engine available' });
    }
    // @ts-expect-error Citation counts must remain numeric.
    formatResearchResult({ ...compatible, citations: { ...compatible.citations, total: 'one' } });
  `);
  requireOk('packed-research-format-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--target', 'ES2022', researchFormatTypes], { cwd: ephemeral }));
  // Keep Core outside the launcher fixture so missing dependencies remain visible.
  const coreCompatibility = join(scratch, 'core-compatibility');
  mkdirSync(coreCompatibility);
  const corePack = requireOk('pack:legacy-core', run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', packRoot], { cwd: join(root, 'packages/core') }));
  const packedCore = JSON.parse(corePack.stdout)[0];
  const coreCatalog = createNpmReleaseCatalog(JSON.parse(readFileSync(join(root, 'package-lock.json'), 'utf8')), ['packages/core']);
  const coreArtifacts = Object.fromEntries(Object.entries(artifacts).filter(([id]) => coreCatalog.packages[`node_modules/${id}`]));
  coreArtifacts['@kernlang/agon-core'] = { version: packedCore.version, resolved: `file:${join(packRoot, packedCore.filename)}`, integrity: packedCore.integrity };
  const coreFrozen = createFrozenNpmInstall(coreCatalog, ['@kernlang/agon-core'], coreArtifacts);
  writeFileSync(join(coreCompatibility, 'package.json'), JSON.stringify(coreFrozen.manifest, null, 2));
  const coreLockBytes = JSON.stringify(coreFrozen.lock, null, 2);
  writeFileSync(join(coreCompatibility, 'package-lock.json'), coreLockBytes);
  requireOk('legacy-core-frozen-hydration', run('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund', '--omit=optional', '--offline'], { cwd: coreCompatibility }));
  if (readFileSync(join(coreCompatibility, 'package-lock.json'), 'utf8') !== coreLockBytes) throw new Error('Core compatibility hydration changed the frozen lock');
  requireOk('packed-research-response-standalone', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { readFileSync } from 'node:fs';
    import { parseAuthoritativeResults } from '@kernlang/agon-mod-research/response-policy';
    const entry = new URL(import.meta.resolve('@kernlang/agon-mod-research/response-policy'));
    assert.doesNotMatch(readFileSync(entry, 'utf8'), /\\bimport\\s*(?:[('"*{]|[A-Za-z_$])/);
    for (const raw of ['null', '{"items":{}}', '{"items":[null]}', 'not json']) {
      assert.deepEqual(parseAuthoritativeResults('github', raw), []);
    }
    assert.deepEqual(parseAuthoritativeResults('package', '{"objects":[{"package":{"name":"yaml"}}]}'),
      [{ title: 'yaml', url: 'https://www.npmjs.com/package/yaml', snippet: '' }]);
  `], { cwd: coreCompatibility }));
  requireOk('packed-research-response-owner', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import * as research from '@kernlang/agon-mod-research';
    import * as policy from '@kernlang/agon-mod-research/response-policy';
    import * as core from '@kernlang/agon-core';
    const installedRoot = pathToFileURL(process.cwd() + '/node_modules/').href;
    for (const id of ['@kernlang/agon-mod-research', '@kernlang/agon-mod-research/response-policy', '@kernlang/agon-core']) {
      assert.ok(import.meta.resolve(id).startsWith(installedRoot));
    }
    assert.equal(core.parseAuthoritativeResults, policy.parseAuthoritativeResults);
    assert.equal(research.parseAuthoritativeResults, policy.parseAuthoritativeResults);
  `], { cwd: coreCompatibility }));
  const responseTypes = join(coreCompatibility, 'research-response-types.mts');
  writeFileSync(responseTypes, `
    import { parseAuthoritativeResults, type ResearchSearchResult } from '@kernlang/agon-mod-research';
    import { parseAuthoritativeResults as policy } from '@kernlang/agon-mod-research/response-policy';
    import { parseAuthoritativeResults as legacy, type SearchResult } from '@kernlang/agon-core';
    const result: ResearchSearchResult[] = parseAuthoritativeResults('github', '{}');
    const oldResult: SearchResult[] = result;
    const compatible: ResearchSearchResult[] = oldResult;
    const legacySignature: typeof parseAuthoritativeResults = legacy;
    const reverseSignature: typeof legacy = parseAuthoritativeResults;
    const policySignature: typeof parseAuthoritativeResults = policy;
    // @ts-expect-error Unsupported routing lanes remain invalid.
    parseAuthoritativeResults('pypi', '{}');
    // @ts-expect-error The parser takes JSON text, not a parsed object.
    parseAuthoritativeResults('github', {});
    // @ts-expect-error Public result fields remain strings.
    const invalid: ResearchSearchResult = { title: 'title', url: 42, snippet: '' };
    void [compatible, legacySignature, reverseSignature, policySignature, invalid];
  `);
  requireOk('packed-research-response-public-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--target', 'ES2022', responseTypes], { cwd: coreCompatibility }));
  requireOk('packed-research-discovery-owner', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import * as research from '@kernlang/agon-mod-research';
    import * as policy from '@kernlang/agon-mod-research/discovery-policy';
    import * as core from '@kernlang/agon-core';
    const installedRoot = pathToFileURL(process.cwd() + '/node_modules/').href;
    for (const id of ['@kernlang/agon-mod-research', '@kernlang/agon-mod-research/discovery-policy', '@kernlang/agon-core']) {
      assert.ok(import.meta.resolve(id).startsWith(installedRoot));
    }
    for (const name of ['cleanQuery', 'buildAuthoritativeRequest']) {
      assert.equal(research[name], policy[name]);
      assert.equal(core[name], policy[name]);
    }
    assert.equal(policy.cleanQuery('npm a charting library'), 'charting');
    assert.equal(new URL(policy.buildAuthoritativeRequest('rfc', 'RFC 07231').url).searchParams.get('name__icontains'), 'rfc7231');
    assert.equal(policy.buildAuthoritativeRequest('package', '   '), null);
    assert.equal(policy.buildAuthoritativeRequest('general', 'hello'), null);
    assert.equal(new URL(policy.buildAuthoritativeRequest('package', 'yaml', 0).url).searchParams.get('size'), '5');
  `], { cwd: coreCompatibility }));
  const discoveryTypes = join(coreCompatibility, 'research-discovery-types.mts');
  writeFileSync(discoveryTypes, `
    import { buildAuthoritativeRequest, type ResearchRequest } from '@kernlang/agon-mod-research';
    import { buildAuthoritativeRequest as policy } from '@kernlang/agon-mod-research/discovery-policy';
    import { buildAuthoritativeRequest as legacy, type SearchRequest } from '@kernlang/agon-core';
    const result: ResearchRequest | null = buildAuthoritativeRequest('rfc', 'RFC 9110');
    const oldResult: SearchRequest | null = result;
    const compatible: ResearchRequest | null = oldResult;
    const legacySignature: typeof buildAuthoritativeRequest = legacy;
    const reverseSignature: typeof legacy = buildAuthoritativeRequest;
    const policySignature: typeof buildAuthoritativeRequest = policy;
    const post: ResearchRequest = { url: 'https://example.org', method: 'POST', headers: {}, body: 'body' };
    const oldPost: SearchRequest = post;
    const newPost: ResearchRequest = oldPost;
    // @ts-expect-error Unsupported routing lanes remain invalid.
    buildAuthoritativeRequest('pypi', 'yaml');
    // @ts-expect-error Count remains numeric.
    buildAuthoritativeRequest('package', 'yaml', 'five');
    // @ts-expect-error Method remains a closed union.
    const invalid: ResearchRequest = { ...post, method: 'DELETE' };
    void [compatible, legacySignature, reverseSignature, policySignature, newPost, invalid];
  `);
  requireOk('packed-research-discovery-public-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--target', 'ES2022', discoveryTypes], { cwd: coreCompatibility }));
  requireOk('packed-research-query-owner', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import { classifyQuery } from '@kernlang/agon-mod-research';
    import { classifyQuery as policy } from '@kernlang/agon-mod-research/query-policy';
    import { classifyQuery as legacy } from '@kernlang/agon-core';
    const installedRoot = pathToFileURL(process.cwd() + '/node_modules/').href;
    for (const id of ['@kernlang/agon-mod-research', '@kernlang/agon-mod-research/query-policy', '@kernlang/agon-core']) {
      assert.ok(import.meta.resolve(id).startsWith(installedRoot));
    }
    assert.equal(classifyQuery, policy);
    assert.equal(classifyQuery, legacy);
    for (const [query, expected] of [
      ['pip module for parsing yaml', 'general'], ['npm package for parsing yaml', 'package'],
      ['github repository for yaml', 'github'], ['github issues', 'general'],
      ['Stack Overflow npm package', 'qa'], ['RFC 9110', 'rfc'],
      ['WHATWG specification', 'standard'], ['what is yaml', 'fact']
    ]) assert.equal(classifyQuery(query), expected, query);
  `], { cwd: coreCompatibility }));
  const queryTypes = join(coreCompatibility, 'research-query-types.mts');
  writeFileSync(queryTypes, `
    import { classifyQuery, type ResearchIntent } from '@kernlang/agon-mod-research';
    import { classifyQuery as policy, type ResearchIntent as PolicyIntent } from '@kernlang/agon-mod-research/query-policy';
    import { classifyQuery as legacy, type ResearchIntent as LegacyIntent } from '@kernlang/agon-core';
    const result: ResearchIntent = classifyQuery('npm package');
    const oldResult: LegacyIntent = result;
    const policyResult: PolicyIntent = oldResult;
    const compatible: ResearchIntent = policyResult;
    const legacySignature: typeof classifyQuery = legacy;
    const policySignature: typeof classifyQuery = policy;
    // @ts-expect-error Unsupported routing lanes must remain invalid.
    const invalid: ResearchIntent = 'pypi';
    // @ts-expect-error The public query input must remain a string.
    classifyQuery(42);
    void [compatible, legacySignature, policySignature, invalid];
  `);
  requireOk('packed-research-query-public-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--target', 'ES2022', queryTypes], { cwd: coreCompatibility }));
  // Core is a legacy public API, not part of the modular launcher release set.
  requireOk('packed-research-citation-owner', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import * as research from '@kernlang/agon-mod-research';
    import * as policy from '@kernlang/agon-mod-research/citation-policy';
    import * as core from '@kernlang/agon-core';
    const installedRoot = pathToFileURL(process.cwd() + '/node_modules/').href;
    for (const id of ['@kernlang/agon-mod-research', '@kernlang/agon-core']) {
      assert.ok(import.meta.resolve(id).startsWith(installedRoot));
    }
    for (const name of ['extractCitations', 'judgeProbe', 'formatCitationReport']) {
      assert.equal(typeof research[name], 'function');
      assert.equal(core[name], research[name], name);
      assert.equal(policy[name], research[name], name);
    }
    assert.deepEqual(research.extractCitations('(see https://example.org/Page_(topic)).'), ['https://example.org/Page_(topic)']);
    const probe = { url: 'https://example.org', finalUrl: 'https://example.org/', ok: true,
      status: 200, crossHostRedirect: false, sample: 'unrelated text' };
    const verdict = research.judgeProbe(probe, ['evidence']);
    assert.equal(verdict.verdict, 'irrelevant');
    assert.equal(verdict.finalUrl, probe.finalUrl);
    assert.equal(research.judgeProbe({ ...probe, status: 999 }).verdict, 'blocked');
    assert.ok(research.formatCitationReport({ total: 1, verified: 0, rejected: 1, blocked: 0, results: [verdict] }).includes('0/1 verified'));
  `], { cwd: coreCompatibility }));
  const citationTypes = join(coreCompatibility, 'research-citation-types.mts');
  writeFileSync(citationTypes, `
    import { extractCitations, judgeProbe, formatCitationReport,
      type CitationStatus, type CitationProbe, type CitationVerdict, type CitationReport } from '@kernlang/agon-mod-research';
    import { judgeProbe as legacyJudge, type CitationStatus as LegacyStatus,
      type CitationProbe as LegacyProbe, type CitationVerdict as LegacyVerdict,
      type CitationReport as LegacyReport } from '@kernlang/agon-core';
    const status: CitationStatus = 'irrelevant';
    const probe: CitationProbe = { url: 'https://example.org', finalUrl: 'https://example.org',
      ok: true, status: 200, crossHostRedirect: false, sample: 'evidence' };
    const verdict: CitationVerdict = judgeProbe(probe, ['evidence']);
    const report: CitationReport = { total: 1, verified: 1, rejected: 0, blocked: 0, results: [verdict] };
    const legacy: LegacyReport = report;
    const compatible: CitationReport = legacy;
    const sameSignature: typeof judgeProbe = legacyJudge;
    const legacyStatus: LegacyStatus = status;
    const legacyProbe: LegacyProbe = probe;
    const legacyVerdict: LegacyVerdict = verdict;
    const currentStatus: CitationStatus = legacyStatus;
    const currentProbe: CitationProbe = legacyProbe;
    const currentVerdict: CitationVerdict = legacyVerdict;
    const urls: string[] = extractCitations('text', 20);
    const formatted: string = formatCitationReport(compatible);
    // @ts-expect-error Unknown verdicts must remain invalid.
    const invalidStatus: CitationStatus = 'probably';
    // @ts-expect-error Historical reports require the rejected count.
    const missingCount: CitationReport = { total: 0, verified: 0, blocked: 0, results: [] };
    // @ts-expect-error HTTP status must remain numeric.
    judgeProbe({ ...probe, status: '200' });
    // @ts-expect-error Historical verdicts require the final URL.
    const missingFinalUrl: LegacyVerdict = { url: probe.url, verdict: 'verified', httpStatus: 200, detail: 'ok' };
    void [status, sameSignature, urls, formatted, invalidStatus, missingCount, missingFinalUrl,
      currentStatus, currentProbe, currentVerdict];
  `);
  requireOk('packed-research-citation-public-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--target', 'ES2022', citationTypes], { cwd: coreCompatibility }));
  requireOk('packed-agent-team-runtime-owner', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { AgentTeamRuntime } from '@kernlang/agon-mod-agent';
    const controller = new AbortController();
    let sessions = 0, cancellations = 0;
    const effects = {
      repoRoot: cwd => cwd, stashSnapshot: () => 'snapshot', worktreePruneAll: () => {},
      worktreeCreate: () => { throw new Error('non-isolated run created a worktree'); },
      worktreeRemoveBestEffort: () => { throw new Error('non-isolated run removed a worktree'); },
      createSession: config => {
        sessions++; assert.equal(config.cwd, '/fixture');
        return { step: async prompt => ({ response: prompt, toolCalls: 0, innerSteps: 1,
          tokensUsed: 1, costUsd: 0, stopReason: 'completed' }),
          cancel: () => { cancellations++; controller.abort(); },
          getSignal: () => controller.signal, getStats: () => ({ tokensUsed: 0 }) };
      },
    };
    const config = { cwd: '/fixture', isolate: false, budget: { maxTurns: 1, maxDurationMs: 1000 },
      members: [{ engineId: 'one', api: { baseUrl: 'https://example.invalid', apiKeyEnv: 'UNUSED_FIXTURE_KEY', model: 'fixture' } }] };
    const team = new AgentTeamRuntime(config, effects);
    await team.initialize();
    const result = await team.step('fixture answer');
    assert.equal(result.members[0].stepResult.response, 'fixture answer');
    assert.equal(result.baseSha, 'snapshot'); assert.equal(result.succeeded, 1);
    await team.cleanup(); assert.equal(sessions, 1); assert.equal(cancellations, 1);
    await assert.rejects(team.step('again'), { name: 'AgentTeamDisposedError' });
    const refused = new AgentTeamRuntime({ ...config, executionRefusal: () => 'Agent disabled' },
      { ...effects, stashSnapshot: () => { throw new Error('effect before authority check'); } });
    await assert.rejects(refused.initialize(), /Agent disabled/);
    assert.equal(sessions, 1);
  `], { cwd: ephemeral }));
  const agentTypes = join(ephemeral, 'agent-team-types.mts');
  writeFileSync(agentTypes, `import { scoreAgentTeamResult, type AgentTeamResult, type AgentTeamMemberResult, type AgentTeamScore, type AgentTeamShortstatReader } from '@kernlang/agon-mod-agent';
    import { AgentTeamRuntime, type AgentTeamConfig, type AgentTeamRuntimeEffects, type AgentTeamSession } from '@kernlang/agon-mod-agent';
    declare const config: AgentTeamConfig;
    declare const effects: AgentTeamRuntimeEffects;
    declare const session: AgentTeamSession;
    const runtime = new AgentTeamRuntime(config, effects);
    const completion: Promise<AgentTeamResult> = runtime.step('task', { onEvent: event => {
      // @ts-expect-error The public event contract must not become any.
      event.notAnAgentEventField;
    } });
    // @ts-expect-error Host composition is required; the owner must not fall back to Core.
    new AgentTeamRuntime(config);
    // @ts-expect-error Unknown stop reasons must not cross the session boundary.
    const invalidSession: AgentTeamSession = { ...session, step: async () => ({ response: '', toolCalls: 0, innerSteps: 0, tokensUsed: 0, costUsd: 0, stopReason: 'invented' }) };
    void completion; void invalidSession;
    const member: AgentTeamMemberResult = { engineId: 'worker', worktreePath: null, error: null,
      stepResult: { response: 'answer', toolCalls: 1, innerSteps: 1, tokensUsed: 1, costUsd: 0, stopReason: 'completed' } };
    const team: AgentTeamResult = { members: [member], runId: 'run', baseSha: 'base', durationMs: 0, succeeded: 0, failed: 1 };
    const read: AgentTeamShortstatReader = () => ({ filesChanged: 0, linesChanged: 0 });
    const result: Map<string, AgentTeamScore> = scoreAgentTeamResult(team, 'edit', undefined, read);
    void result;
    // @ts-expect-error Unsupported task kinds must not cross this boundary.
    scoreAgentTeamResult(team, 'unknown', undefined, read);
    // @ts-expect-error Nested result fields must retain their types.
    const invalid: AgentTeamMemberResult = { ...member, stepResult: { ...member.stepResult!, toolCalls: 'one' } };
    void invalid;
  `);
  requireOk('packed-agent-team-public-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--target', 'ES2022', agentTypes], { cwd: ephemeral }));
  const coreTypes = join(scratch, 'core-agent-team-types.mts');
  writeFileSync(coreTypes, `import { scoreAgentTeamResult, type AgentTeamResult, type AgentTeamMemberResult, type EngineResult } from ${JSON.stringify(join(root, 'packages/core/dist/index.js'))};
    const member: AgentTeamMemberResult = { engineId: 'worker', worktreePath: null, error: null,
      stepResult: { response: 'answer', toolCalls: 1, innerSteps: 1, tokensUsed: 1, costUsd: 0, stopReason: 'completed' } };
    const team: AgentTeamResult = { members: [member], runId: 'run', baseSha: 'base', durationMs: 0, succeeded: 1, failed: 0 };
    const result: Map<string, EngineResult> = scoreAgentTeamResult(team, '/fixture', 'edit', new Map());
    void result;
    // @ts-expect-error The legacy public signature still requires a repository path.
    scoreAgentTeamResult(team, 'edit', new Map());
  `);
  requireOk('compiled-core-agent-team-public-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--target', 'ES2022', coreTypes], { cwd: scratch }));
  requireOk('packed-shared-git-diff-owner', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import * as worktree from '@kernlang/agon-support-worktree';
    const installedRoot = pathToFileURL(process.cwd() + '/node_modules/').href;
    assert.ok(import.meta.resolve('@kernlang/agon-support-worktree').startsWith(installedRoot), 'shared owner must resolve from the installed prefix');
    for (const name of ['isTestFile', 'parseChangedLines', 'newFilesInDiff']) {
      assert.equal(typeof worktree[name], 'function', name);
    }
    assert.equal(worktree.isTestFile('tests/example.test.ts'), true);
    assert.equal(worktree.isTestFile('src/example.ts'), false);
    const diff = ['--- /dev/null', '+++ b/tests/example.test.ts', '@@ -0,0 +1,2 @@', '+first', '+second'].join('\\n');
    assert.deepEqual(worktree.parseChangedLines(diff), { 'tests/example.test.ts': [1, 2] });
    assert.deepEqual(worktree.newFilesInDiff(diff), ['tests/example.test.ts']);
  `], { cwd: ephemeral }));
  requireOk('packed-post-synthesis-fitness-owner', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { existsSync } from 'node:fs';
    import { pathToFileURL } from 'node:url';
    import { runPostSynthesisFitnessCheck } from '@kernlang/agon-mod-forge';
    assert.ok(import.meta.resolve('@kernlang/agon-mod-forge').startsWith(pathToFileURL(process.cwd() + '/node_modules/').href));
    const worktreePath = process.cwd();
    const success = await runPostSynthesisFitnessCheck({ worktreePath, fitnessCmd: 'test -d node_modules' });
    assert.equal(success.passed, true); assert.equal(success.exitCode, 0); assert.equal(success.error, null);
    const failure = await runPostSynthesisFitnessCheck({ worktreePath, fitnessCmd: 'exit 7' });
    assert.equal(failure.passed, false); assert.equal(failure.exitCode, 7); assert.equal(failure.error, null);
    const timeout = await runPostSynthesisFitnessCheck({ worktreePath, fitnessCmd: 'sleep 5', timeoutSec: 0.05 });
    assert.equal(timeout.passed, false); assert.equal(timeout.exitCode, 124);
    const abort = new AbortController(); abort.abort(new Error('fixture cancelled'));
    const cancelled = await runPostSynthesisFitnessCheck({ worktreePath, fitnessCmd: 'touch forbidden-fitness', signal: abort.signal });
    assert.equal(cancelled.passed, false); assert.equal(cancelled.error, 'fixture cancelled');
    const denied = await runPostSynthesisFitnessCheck({ worktreePath, fitnessCmd: 'touch forbidden-fitness', executionRefusal: () => 'fixture disabled' });
    assert.equal(denied.passed, false); assert.equal(denied.error, 'fixture disabled');
    assert.equal(existsSync('forbidden-fitness'), false);
  `], { cwd: ephemeral }));
  const fitnessExample = join(ephemeral, 'post-synthesis-fitness-contract.mts');
  writeFileSync(fitnessExample, `
    import { runPostSynthesisFitnessCheck, type PostSynthesisFitnessResult } from '@kernlang/agon-mod-forge';
    const result: Promise<PostSynthesisFitnessResult> = runPostSynthesisFitnessCheck({ worktreePath: '.', fitnessCmd: 'true', timeoutSec: 1 });
    void result;
    // @ts-expect-error A fitness invocation requires its command.
    runPostSynthesisFitnessCheck({ worktreePath: '.' });
    // @ts-expect-error Authority refusals are reasons, not booleans.
    runPostSynthesisFitnessCheck({ worktreePath: '.', fitnessCmd: 'true', executionRefusal: () => false });
  `);
  requireOk('packed-post-synthesis-fitness-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--target', 'ES2022', '--types', 'node', '--typeRoots', join(root, 'node_modules/@types'), fitnessExample], { cwd: ephemeral }));
  requireOk('packed-provenance-report-owner', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
    import { join } from 'node:path';
    import { pathToFileURL } from 'node:url';
    import { spawnSync } from 'node:child_process';
    import * as reports from '@kernlang/agon-mod-provenance';
    assert.ok(import.meta.resolve('@kernlang/agon-mod-provenance').startsWith(pathToFileURL(process.cwd() + '/node_modules/').href));
    const manifest = { forgeId: 'report', task: 'fixture task', timestamp: '2026',
      engines: ['a', 'b'], winner: 'a', fitnessCmd: 'npm test\\nnpm run typecheck',
      results: { a: { score: 9, pass: true }, b: { score: 4, pass: false } },
      dispatchLog: [{ engineId: 'a', tokens: { costUsd: 0 } }],
      synthesis: { wins: true, score: 10, pass: true, originalWinnerScore: 9 } };
    const reportHome = join(process.cwd(), 'report-home');
    mkdirSync(join(reportHome, 'runs'), { recursive: true });
    const source = join(reportHome, 'runs', 'report.json');
    writeFileSync(source, JSON.stringify(manifest));
    const ledger = reports.buildForgeProvenance(manifest, source);
    assert.equal(ledger.contributions[0].costUsd, 0);
    assert.equal(ledger.sourceHashes['manifest.json'], reports.sha256OfFile(source));
    assert.equal(JSON.parse(reports.renderProvenanceJson(ledger)).winner, 'a');
    assert.equal(reports.renderMarkdown, reports.renderProvenanceMarkdown);
    const markdown = reports.writeProvenanceReport(manifest, source, join(reportHome, 'output'), 'both');
    assert.ok(readFileSync(markdown, 'utf8').includes('**Winner:**'));
    assert.ok(readFileSync(markdown, 'utf8').includes('*synthesis blend*'));
    const cli = join(process.cwd(), 'node_modules/@kernlang/agon/dist/index.js');
    const output = spawnSync(process.execPath, [cli, 'provenance', '--id', 'report', '--format', 'md'],
      { cwd: process.cwd(), encoding: 'utf8', timeout: 30000, env: { ...process.env, AGON_HOME: reportHome } });
    assert.equal(output.status, 0, output.stderr);
    assert.ok(output.stdout.includes('**Winner:**'));
    assert.ok(output.stdout.includes('*synthesis blend*'));
    assert.ok(output.stdout.includes('npm test npm run typecheck'));
  `], { cwd: ephemeral }));
  const provenanceExample = join(ephemeral, 'provenance-public-contract.mts');
  writeFileSync(provenanceExample, `
    import { buildForgeProvenance, buildProvenance, renderProvenanceMarkdown, renderMarkdown,
      renderProvenanceJson, writeProvenanceReport, type ProvenanceLedger, type ProvenanceManifest,
      type ProvenanceContribution } from '@kernlang/agon-mod-provenance';
    const input: ProvenanceManifest = { forgeId: 'id', task: 'task', timestamp: '2026' };
    const ledger: ProvenanceLedger = buildForgeProvenance(input, 'manifest.json');
    const physical: ProvenanceLedger = buildProvenance(input, 'manifest.json');
    const contribution: ProvenanceContribution | undefined = ledger.contributions[0];
    const outputs: string[] = [renderProvenanceMarkdown(ledger), renderMarkdown(physical),
      renderProvenanceJson(ledger), writeProvenanceReport(input, 'manifest.json', 'output', 'both')];
    // @ts-expect-error Unknown autonomy labels must not cross the public contract.
    const invalid: ProvenanceLedger['autonomyLevel'] = 'invented';
    void outputs; void contribution; void invalid;
  `);
  requireOk('packed-provenance-public-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--types', 'node', '--typeRoots', join(root, 'node_modules/@types'), provenanceExample], { cwd: ephemeral }));
  requireOk('packed-synthesis-runtime', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import { runSynthesisRuntime, buildSynthesisDraftPrompt, createSynthesisHostServices, createMod } from '@kernlang/agon-mod-synthesis';
    const installedRoot = pathToFileURL(process.cwd() + '/node_modules/').href;
    assert.ok(import.meta.resolve('@kernlang/agon-mod-synthesis').startsWith(installedRoot));
    assert.match(buildSynthesisDraftPrompt('Design'), /^## SYNTHESIS DRAFT/);
    const calls = [], events = [];
    const result = await runSynthesisRuntime({
      prompt: 'Design', engines: ['alpha', 'beta'], swaps: 1, timeout: 10,
      outputDir: process.cwd(), registry: { get: id => ({ id }), findBinary: () => null },
      adapter: { dispatch: async request => {
        calls.push(request);
        return { stdout: request.prompt.startsWith('## SYNTHESIS JUDGE')
          ? 'SCORE_1: 80\\nSCORE_2: 60\\nWINNER: alpha\\nREASONING: fixture'
          : 'fixture draft', stderr: '', exitCode: 0, timedOut: false };
      } }, onEvent: event => events.push(event),
    }, { resolveWorkingDir: () => process.cwd(), health: { loadConfig: () => ({}) },
      warn: message => { throw new Error(message); } });
    assert.equal(calls.length, 4);
    assert.ok(calls.every(request => request.textOnly === true));
    assert.equal(result.drafts.length, 2);
    assert.equal(result.swaps.length, 1);
    assert.equal(result.winner, 'alpha');
    assert.deepEqual(events.map(event => event.type), ['synthesis:draft', 'synthesis:draft', 'synthesis:swap', 'synthesis:score']);
    const surfaces = new Map(), finishes = [], receipts = [];
    let revoked = false;
    const context = { invocationId: 'packed-synthesis', cwd: process.cwd(),
      platform: process.platform + '-' + process.arch, signal: new AbortController().signal, config: {} };
    const services = {
      engines: { listActive: async () => ['alpha', 'beta'] },
      runs: { start: async () => ({ id: 'packed', path: process.cwd(), startedAt: 'fixture' }),
        finish: async (_handle, status) => { finishes.push(status); } },
      receipts: { record: async (...args) => { receipts.push(args); return 'receipt'; } },
      synthesis: createSynthesisHostServices({
        openRegistry: cwd => { assert.equal(cwd, context.cwd); return { get: id => ({ id }), findBinary: () => null }; },
        createAdapter: () => ({ dispatch: async request => {
          calls.push(request);
          assert.equal(request.cwd, context.cwd);
          return { stdout: request.mode === 'review'
            ? 'SCORE_1: 80\\nSCORE_2: 60\\nWINNER: alpha\\nREASONING: fixture'
            : 'fixture draft', stderr: '', exitCode: 0, timedOut: false };
        } }),
        captureAuthority: () => () => { if (revoked) throw new Error('generation revoked'); },
        loadConfig: () => ({}), warn: message => { throw new Error(message); },
      }),
    };
    const registrar = new Proxy({}, { get: (_target, method) => (...args) => {
      if (method === 'command' || method === 'tool') {
        const [surface, contribution] = args;
        surfaces.set(surface, contribution);
        return () => { surfaces.delete(surface); };
      }
      return () => {};
    } });
    const dispose = await (await createMod(services)).activate(registrar);
    assert.deepEqual([...surfaces.keys()].sort(), ['cli', 'mcp', 'tui']);
    for (const [surface, contribution] of surfaces) {
      calls.length = 0;
      const input = surface === 'tui'
        ? contribution.parse('/synthesis --swaps 1 Design')
        : { prompt: 'Design', swaps: '1', engines: 'alpha,beta' };
      const output = await contribution.run(input, context);
      const value = surface === 'mcp' ? output : output.result;
      if (surface !== 'mcp') assert.equal(output.exitCode, 0);
      assert.equal(value.winner, 'alpha');
      assert.equal(value.drafts.length, 2);
      assert.equal(value.swaps.length, 1);
      assert.equal(calls.length, 4);
      assert.ok(calls.every(request => request.textOnly === true));
      assert.equal(calls.at(-1).mode, 'review');
    }
    assert.equal(finishes.length, 3);
    assert.ok(finishes.every(status => status.ok === true));
    assert.equal(receipts.length, 3);
    revoked = true;
    calls.length = 0;
    for (const [surface, contribution] of surfaces) {
      await assert.rejects(() => contribution.run(surface === 'tui' ? { input: 'Design' } : { prompt: 'Design' }, context), /generation revoked/);
    }
    assert.equal(calls.length, 0);
    assert.equal(finishes.length, 3);
    assert.equal(receipts.length, 3);
    await dispose();
    assert.equal(surfaces.size, 0);
  `], { cwd: ephemeral, env: { AGON_FORCE_HEALTH_PROBE: '', AGON_DISABLE_FORGE_HEALTH_CHECK: '1' } }));
  requireOk('packed-synthesis-session', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { runSynthesisSession } from '@kernlang/agon-mod-synthesis';
    const messages = [], results = [], runs = [];
    let disposed = 0;
    const host = {
      assertCurrent() {}, now: () => 0, defaultEngines: () => ['alpha', 'beta'],
      dispatch() {}, scheduleEvery: () => () => { disposed++; },
      appendMessage: message => messages.push(message), track() {},
      addResult: result => results.push(result), recordRun: run => runs.push(run),
    };
    const context = { cwd: process.cwd(), signal: new AbortController().signal };
    const result = { winner: 'alpha', judgeReasoning: 'selected',
      drafts: [{ engineId: 'alpha', content: 'initial' }],
      swaps: [{ toEngineId: 'alpha', improvedContent: 'final revision' }],
      scores: [{ engineId: 'alpha', score: 90 }] };
    await runSynthesisSession({ input: 'Design' }, context, host, async input => {
      assert.equal(input.engines, 'alpha,beta');
      return { exitCode: 0, result };
    });
    assert.equal(messages[1].content, 'final revision');
    assert.equal(results[0].winner, 'alpha');
    assert.equal(runs[0].success, true);
    assert.equal(disposed, 1);
    await assert.rejects(runSynthesisSession({ input: 'Design' }, context, host,
      async () => ({ exitCode: 1, stderr: 'judge failed' })), /judge failed/);
    assert.equal(messages.length, 2);
    assert.equal(runs.length, 1);
    assert.equal(disposed, 2);
  `], { cwd: ephemeral }));
  const synthesisExample = join(ephemeral, 'synthesis-public-contract.mts');
  writeFileSync(synthesisExample, `
    import { runSynthesisRuntime, type SynthesisRuntimeOptions, type SynthesisRuntimeEffects,
      type SynthesisResult, type SynthesisRuntimeEvent, runSynthesisSession,
      type SynthesisSessionHost, type SynthesisSessionContext,
      type SynthesisSessionCommandResult, createSynthesisHostServices,
      type SynthesisHostServices } from '@kernlang/agon-mod-synthesis';
    declare const options: SynthesisRuntimeOptions;
    declare const effects: SynthesisRuntimeEffects;
    const result: Promise<SynthesisResult> = runSynthesisRuntime(options, effects);
    const event: SynthesisRuntimeEvent = { type: 'synthesis:draft', engineId: 'fixture', data: { round: 0 } };
    void result; void event;
    declare const host: SynthesisSessionHost;
    declare const context: SynthesisSessionContext;
    declare const execute: (input: Record<string, unknown>, context: SynthesisSessionContext) => Promise<SynthesisSessionCommandResult>;
    const session: Promise<SynthesisResult> = runSynthesisSession({ input: 'Design' }, context, host, execute);
    void session;
    // @ts-expect-error Session execution requires a complete effect host.
    runSynthesisSession({}, context, {}, execute);
    declare const hostEffects: Parameters<typeof createSynthesisHostServices>[0];
    const hostServices: SynthesisHostServices = createSynthesisHostServices(hostEffects);
    const { captureAuthority, ...withoutAuthority } = hostEffects;
    void captureAuthority;
    // @ts-expect-error Every host must capture generation authority.
    createSynthesisHostServices(withoutAuthority);
    // @ts-expect-error Opening a host requires an invocation context.
    hostServices.open();
  `);
  requireOk('packed-synthesis-public-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--types', 'node', '--typeRoots', join(root, 'node_modules/@types'), synthesisExample], { cwd: ephemeral }));
  requireOk('packed-agent-refinement', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import { runAgentTeamSynthesis, runAgentInvestigateSynthesis } from '@kernlang/agon-mod-agent';
    const installedRoot = pathToFileURL(process.cwd() + '/node_modules/').href;
    assert.ok(import.meta.resolve('@kernlang/agon-mod-agent').startsWith(installedRoot));
    const calls = [];
    const runtime = {
      runApiAgentLoop: async options => {
        calls.push('api');
        assert.equal(options.cwd, process.cwd());
        return { response: 'refined report', toolCalls: 0, steps: 1 };
      },
      recordApiLoopDispatch: () => { calls.push('ledger'); },
      worktreeChangedDiff: () => { calls.push('diff'); return 'refined patch'; },
    };
    const options = { task: 'fixture', winnerEngineId: 'winner',
      winnerApi: { baseUrl: 'https://example.invalid', apiKeyEnv: 'FIXTURE_KEY', model: 'fixture' },
      winnerWorktreePath: process.cwd(), winnerCwd: process.cwd(), winnerDiff: 'original patch',
      winnerResponse: 'original report', baseSha: 'fixture', timeout: 1,
      losers: [{ engineId: 'other', diff: 'other patch', response: 'other report', passedFitness: true }] };
    assert.deepEqual(await runAgentTeamSynthesis(options, runtime), {
      ok: true, synthesizedDiff: 'refined patch', changed: true, error: null, responseExcerpt: 'refined report', skipped: false,
    });
    assert.deepEqual(await runAgentInvestigateSynthesis(options, runtime), {
      ok: true, report: 'refined report', error: null, skipped: false,
    });
    assert.deepEqual(calls, ['api', 'ledger', 'diff', 'api', 'ledger']);
  `], { cwd: ephemeral }));
  const agentExample = join(ephemeral, 'agent-refinement-public-contract.mts');
  writeFileSync(agentExample, `
    import { runAgentTeamSynthesis, runAgentInvestigateSynthesis, type AgentSynthesisOptions,
      type AgentSynthesisResult, type AgentInvestigateSynthesisOptions,
      type AgentInvestigateSynthesisResult, type AgentSynthesisRuntime } from '@kernlang/agon-mod-agent';
    declare const options: AgentSynthesisOptions;
    declare const investigation: AgentInvestigateSynthesisOptions;
    declare const runtime: AgentSynthesisRuntime;
    const edit: Promise<AgentSynthesisResult> = runAgentTeamSynthesis(options, runtime);
    const report: Promise<AgentInvestigateSynthesisResult> = runAgentInvestigateSynthesis(investigation, runtime);
    void edit; void report;
  `);
  requireOk('packed-agent-refinement-public-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--types', 'node', '--typeRoots', join(root, 'node_modules/@types'), agentExample], { cwd: ephemeral }));
  requireOk('packed-agent-events', run(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import { pathToFileURL } from 'node:url';
    import * as agent from '@kernlang/agon-mod-agent';
    const installedRoot = pathToFileURL(process.cwd() + '/node_modules/').href;
    assert.ok(import.meta.resolve('@kernlang/agon-mod-agent').startsWith(installedRoot));
    assert.deepEqual(agent.makeAssistantChunk('engine', 'hello'), { kind: 'assistant_chunk', engineId: 'engine', text: 'hello' });
    assert.deepEqual(agent.makeError('engine', 'failed'), { kind: 'error', engineId: 'engine', message: 'failed', recoverable: false });
    assert.deepEqual(agent.makeTurnComplete('engine', 'end_turn'), { kind: 'turn_complete', engineId: 'engine', stopReason: 'end_turn', usage: null });
    const rejected = agent.normalizeSessionChunk({ type: 'tool_call', content: 'shell', metadata: { status: 'denied', toolCallId: 'id' } }, 'engine');
    assert.deepEqual(rejected, agent.makeToolCall('engine', 'shell', 'rejected', { toolCallId: 'id', terminalReason: 'denied' }));
    assert.equal(agent.normalizeSessionChunk({ type: 'status', content: 'busy' }, 'engine'), null);
    assert.deepEqual(agent.unavailableUsage(), { promptTokens: 0, completionTokens: 0, totalTokens: 0, source: 'unavailable' });
    assert.deepEqual(agent.estimatedUsage('12345', '1234'), { promptTokens: 2, completionTokens: 1, totalTokens: 3, source: 'estimated' });
    assert.deepEqual(agent.buildApiTurnEvents('engine', '', 0, 'end_turn'), [agent.makeTurnComplete('engine', 'end_turn')]);
  `], { cwd: ephemeral }));
  const agentEventExample = join(ephemeral, 'agent-events-public-contract.mts');
  writeFileSync(agentEventExample, `
    import { makeAssistantChunk, makeToolCall, makeTurnComplete, makeError, normalizeSessionChunk,
      buildApiTurnEvents, unavailableUsage, estimatedUsage, type AgentEvent, type AgentUsage,
      type RawSessionChunk } from '@kernlang/agon-mod-agent';
    const usage: AgentUsage = estimatedUsage('prompt', 'reply');
    const chunk: RawSessionChunk = { type: 'tool_call', content: 'shell', metadata: { status: 'done' } };
    const events: AgentEvent[] = [makeAssistantChunk('engine', 'hello'), makeToolCall('engine', 'shell', 'ok'),
      makeTurnComplete('engine', 'end_turn', usage), makeError('engine', 'failed'),
      ...buildApiTurnEvents('engine', '', 0, 'end_turn', unavailableUsage())];
    const normalized: AgentEvent | null = normalizeSessionChunk(chunk, 'engine');
    for (const event of events) {
      switch (event.kind) {
        case 'assistant_chunk': event.text satisfies string; break;
        case 'tool_call': event.status satisfies 'running' | 'ok' | 'error' | 'rejected'; break;
        case 'turn_complete': event.usage satisfies AgentUsage | null; break;
        case 'error': event.recoverable satisfies boolean; break;
        default: event satisfies never;
      }
    }
    // @ts-expect-error Unknown event kinds must not cross the public boundary.
    const invalid: AgentEvent = { kind: 'unknown', engineId: 'engine' };
    void normalized; void invalid;
  `);
  requireOk('packed-agent-events-public-types', run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit', '--strict', '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext',
    '--types', 'node', '--typeRoots', join(root, 'node_modules/@types'), agentEventExample], { cwd: ephemeral }));
  // Independent probes must not hide later installer failures. Retain every
  // failed check and reject the whole qualification before emitting success.
  for (const [id, verify] of [
    ['packed-mcp', () => verifyPackedMcp(ephemeral, scratch, { ...process.env, npm_config_cache: npmCache })],
    ['packed-synthesis', () => verifyPackedSynthesis(ephemeral, scratch, { ...process.env, npm_config_cache: npmCache })],
    ['packed-brainstorm', () => verifyPackedBrainstorm(ephemeral, scratch, { ...process.env, npm_config_cache: npmCache })],
    ['packed-brainstorm-tui', () => verifyPackedBrainstormTui(ephemeral, scratch, { ...process.env, npm_config_cache: npmCache })],
    ['packed-brainstorm-tui-active-exit', () => verifyPackedBrainstormTui(ephemeral, scratch, { ...process.env, npm_config_cache: npmCache }, { activeExit: true })],
  ]) {
    try { checks.push(await verify()); }
    catch (error) { checks.push({ id, passed: false, detail: String(error) }); }
  }
  const overrideFile = join(scratch, 'package-specs.json');
  writeFileSync(overrideFile, JSON.stringify(tarballs, null, 2));
  const cli = join(ephemeral, 'node_modules', '@kernlang', 'agon', 'dist', 'index.js');
  const setupEnv = { AGON_HOME: home, AGON_MODULAR_HOST_ROOT: join(home, 'modular-host'), AGON_SETUP_PACKAGE_SPECS_FILE: overrideFile,
    AGON_SETUP_LAUNCHER_SPEC: launcherTarball, AGON_S9_NPM_CACHE: npmCache };
  const first = requireOk('npx-setup-first-run', run(process.execPath, [cli, 'setup', '--profile', 'minimal', '--with', 'think,review', '--offline', '--cache', npmCache, '--json'], { cwd: scratch, env: setupEnv }));
  const firstJson = JSON.parse(first.stdout);
  if (firstJson.status !== 'installed' || firstJson.packageCount !== 15 || firstJson.generation !== 1) throw new Error('first setup result is not the exact expected installation');
  checks.push({ id: 'first-run-result', passed: true, detail: 'installed generation 1 with 15-package closure' });
  const stable = join(home, 'bin', 'agon');
  const smoke = requireOk('persistent-launcher-before-cache-delete', run(stable, ['--version'], { cwd: scratch, env: { AGON_HOME: home } }));
  if (!smoke.stdout.includes('1.0.0')) throw new Error('persistent launcher did not report version 1.0.0');
  makeRemovable(ephemeral); rmSync(ephemeral, { recursive: true, force: true });
  checks.push({ id: 'ephemeral-cache-deleted', passed: !existsSync(ephemeral), detail: 'ephemeral npx hydration removed' });
  requireOk('persistent-launcher-after-cache-delete', run(stable, ['--version'], { cwd: scratch, env: { AGON_HOME: home } }));
  const second = requireOk('idempotent-second-setup', run(stable, ['setup', '--profile', 'minimal', '--with', 'think,review', '--offline', '--cache', npmCache, '--json'], { cwd: scratch, env: { ...setupEnv, AGON_SETUP_PACKAGE_SPECS_FILE: overrideFile } }));
  const secondJson = JSON.parse(second.stdout);
  if (secondJson.status !== 'already-qualified' || secondJson.generationUnchanged !== true) throw new Error('second setup was not idempotent');
  checks.push({ id: 'idempotence-result', passed: true, detail: 'generation unchanged' });
  requireOk('managed-mod-list', run(stable, ['mod', 'list'], { cwd: scratch, env: { AGON_HOME: home } }));
  // Exercise the installed launcher, citty parent/child dispatch, durable lock
  // selection, and a NEW process after each mutation. Calling modCommand.run
  // directly cannot detect stale-parent or fresh-bootstrap failures.
  for (const action of ['disable', 'enable']) {
    const preview = JSON.parse(requireOk(`installed-${action}-preview`, run(stable, ['mod', action, 'agon.think'], { cwd: scratch, env: setupEnv })).stdout);
    requireOk(`installed-${action}-apply`, run(stable, ['mod', action, preview.planPath, '--approve', preview.planHash], { cwd: scratch, env: setupEnv }));
    requireOk(`installed-${action}-fresh-start`, run(stable, ['mod', 'list'], { cwd: scratch, env: setupEnv }));
    // citty renders ROOT help successfully for an unknown command with --help.
    // A no-argument invocation distinguishes absence from the enabled handler's
    // missing-problem validation without ever dispatching a model.
    const help = run(stable, action === 'enable' ? ['think', '--help'] : ['think'], { cwd: scratch, env: setupEnv });
    if (action === 'enable') requireOk('re-enabled-think-help', help);
    else {
      const passed = help.status === 1 && /unknown command|unavailable/i.test(help.stderr + help.stdout);
      checks.push({ id: 'disabled-think-unreachable', passed, detail: String(help.stderr + help.stdout).slice(0, 1200) });
      if (!passed) throw new Error('disabled Think is still reachable or failed for an unrelated reason');
    }
  }
  const afterActivation = JSON.parse(requireOk('setup-after-activation', run(stable,
    ['setup', '--profile', 'minimal', '--with', 'think,review', '--offline', '--cache', npmCache, '--json'], { cwd: scratch, env: setupEnv })).stdout);
  if (afterActivation.status !== 'already-qualified') throw new Error('activation lost its qualified installation lineage');
  const host = new DurableModHost(join(home, 'modular-host'), { kernelVersion: release.version });
  const lifecycle = new ManagedLifecycleService(host);
  const previous = await lifecycle.readSelectedInstallation();
  const previousPointer = await host.readCurrentPointer();
  if (!previous || !previousPointer) throw new Error('installed dependency control has no selected installation');
  const dependencyLocation = 'node_modules/semver';
  const dependency = join(host.root, previous.prefix, dependencyLocation, 'package.json');
  // This is an owned disposable installation. Change only JSON whitespace.
  chmodSync(dependency, 0o600);
  writeFileSync(dependency, readFileSync(dependency, 'utf8') + '\n');
  const repaired = JSON.parse(requireOk('setup-rejects-modified-dependency', run(stable,
    ['setup', '--profile', 'minimal', '--with', 'think,review', '--offline', '--cache', npmCache, '--json'], { cwd: scratch, env: setupEnv })).stdout);
  const selected = await lifecycle.readSelectedInstallation();
  if (repaired.status !== 'installed' || repaired.generation !== previousPointer.generation + 1
    || !selected || selected.prefix === previous.prefix
    || await hashInstalledPackagePayload(join(host.root, selected.prefix, dependencyLocation)) !== channel.npmPayloads[dependencyLocation]) {
    throw new Error('modified dependency was reused or replacement was not verified');
  }
  checks.push({ id: 'modified-dependency-requalified', passed: true,
    detail: 'changed retained semver payload forces fresh prefix; new selected payload matches frozen archive identity' });
  const repairedReuse = JSON.parse(requireOk('repaired-installation-reuse', run(stable,
    ['setup', '--profile', 'minimal', '--with', 'think,review', '--offline', '--cache', npmCache, '--json'], { cwd: scratch, env: setupEnv })).stdout);
  if (repairedReuse.status !== 'already-qualified') throw new Error('repaired installation was not reusable');
  // Full compatibility includes 36 mods and 48 packages. The 49th release
  // package is disabled SaaS support, not a default profile dependency.
  for (const [id, profile, withMods, expectedStatus, packageCount] of [
    ['full-profile-install', 'full-compat', null, 'installed', 48],
    ['full-profile-reuse', 'full-compat', null, 'already-qualified', 48],
    ['small-profile-return', 'minimal', 'think,review', 'installed', 15],
    ['small-profile-reuse', 'minimal', 'think,review', 'already-qualified', 15],
  ]) {
    const response = JSON.parse(requireOk(id, run(stable,
      ['setup', '--profile', profile, ...(withMods ? ['--with', withMods] : []), '--offline', '--cache', npmCache, '--json'],
      { cwd: scratch, env: setupEnv })).stdout);
    if (response.status !== expectedStatus || response.packageCount !== packageCount) throw new Error(`${id}: incorrect installation/reuse result`);
    const pointer = await host.readCurrentPointer();
    const desired = pointer && await host.readGenerationDesiredState(pointer);
    if (!desired || desired.selected.length !== (profile === 'full-compat' ? 36 : 3)) throw new Error(`${id}: incorrect selected mod set`);
    checks.push({ id: `${id}-result`, passed: true, detail: `${expectedStatus}; ${packageCount} packages; ${desired.selected.length} selected mods` });
  }
  const provenanceSetup = JSON.parse(requireOk('provenance-profile-install', run(stable,
    ['setup', '--profile', 'minimal', '--with', 'provenance', '--offline', '--cache', npmCache, '--json'],
    { cwd: scratch, env: setupEnv })).stdout);
  if (provenanceSetup.status !== 'installed') throw new Error('Provenance profile was not selected');
  const provenanceInstallation = await lifecycle.readSelectedInstallation();
  if (!provenanceInstallation) throw new Error('Provenance installation is missing');
  const provenancePrefix = join(host.root, provenanceInstallation.prefix);
  const hasProvenance = provenanceInstallation.packages.some(pkg => pkg.id === '@kernlang/agon-mod-provenance');
  const hasForge = provenanceInstallation.packages.some(pkg => pkg.id === '@kernlang/agon-mod-forge');
  if (!hasProvenance || hasForge || existsSync(join(provenancePrefix, 'node_modules/@kernlang/agon-mod-forge'))) {
    throw new Error('Provenance profile must contain Provenance without an installed Forge package');
  }
  checks.push({ id: 'provenance-without-forge-package', passed: true,
    detail: 'selected installation includes Provenance; Forge absent from its package record and node_modules' });
  mkdirSync(join(home, 'runs'), { recursive: true });
  writeFileSync(join(home, 'runs', 'historical-forge.json'), JSON.stringify({
    forgeId: 'historical-forge', task: 'read historical Forge output', timestamp: '2026',
    engines: ['a', 'b'], winner: 'a', fitnessCmd: 'npm test',
    results: { a: { score: 9, pass: true }, b: { score: 4, pass: false } },
    dispatchLog: [{ engineId: 'a', tokens: { costUsd: 0 } }],
    synthesis: { wins: true, score: 10, pass: true, originalWinnerScore: 9 },
  }));
  const provenanceMarkdown = requireOk('provenance-without-forge-markdown', run(stable,
    ['provenance', '--id', 'historical-forge', '--format', 'md'], { cwd: scratch, env: setupEnv })).stdout;
  if (!provenanceMarkdown.includes('**Winner:**') || !provenanceMarkdown.includes('*synthesis blend*')) {
    throw new Error('historical Forge report lost its disclosure without Forge installed');
  }
  const provenanceJson = JSON.parse(requireOk('provenance-without-forge-json', run(stable,
    ['provenance', '--id', 'historical-forge', '--format', 'json'], { cwd: scratch, env: setupEnv })).stdout);
  if (provenanceJson.winner !== 'a' || provenanceJson.contributions[0]?.costUsd !== 0) {
    throw new Error('historical Forge ledger changed without Forge installed');
  }
  const afterProvenance = JSON.parse(requireOk('return-after-provenance-profile', run(stable,
    ['setup', '--profile', 'minimal', '--with', 'think,review', '--offline', '--cache', npmCache, '--json'],
    { cwd: scratch, env: setupEnv })).stdout);
  if (afterProvenance.status !== 'installed' || afterProvenance.packageCount !== 15) {
    throw new Error('small profile could not be restored after Provenance qualification');
  }
  if (checks.some(check => !check.passed)) throw new Error(`packed workflow qualification failed: ${checks.filter(check => !check.passed).map(check => check.id).join(', ')}`);
  const result = { schemaVersion: 1, slice: 'S9', passed: checks.every(({ passed }) => passed), platform: `${process.platform}-${process.arch}`, node: process.version,
    profile: 'minimal+think+review', installedPackageCount: firstJson.packageCount, cacheDeletionSurvived: true, idempotent: true, checks };
  // Scratch cleanup is part of successful qualification. Retry transient
  // ENOTEMPTY/EBUSY failures, but never publish a green receipt before it ends.
  makeRemovable(scratch);
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  if (!process.argv.includes('--no-write')) writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify({ status: 'passed', checks: checks.length, installedPackageCount: firstJson.packageCount, cacheDeletionSurvived: true, idempotent: true }, null, 2));
} catch (error) {
  const failure = { schemaVersion: 1, slice: 'S9', passed: false, platform: `${process.platform}-${process.arch}`, node: process.version,
    scratch, error: String(error), checks };
  if (!process.argv.includes('--no-write')) writeFileSync(output, `${JSON.stringify(failure, null, 2)}\n`);
  console.error(JSON.stringify(failure, null, 2));
  console.error(error);
  process.exitCode = 1;
}
