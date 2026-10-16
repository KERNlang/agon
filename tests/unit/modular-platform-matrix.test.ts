import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { basename, dirname, join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { loadEvidencePasses } from '../../scripts/spec/measure-modular-load.mjs';
import { loadEvidenceFixture } from '../fixtures/modular-load-evidence.js';

const source = readFileSync(new URL('../../scripts/spec/verify-modular-platform-matrix.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replaceAll('import.meta.dirname', JSON.stringify('/fixture/scripts/spec'));

const qualificationSource = readFileSync(new URL('../../scripts/spec/qualify-modular-agon-slice9.mjs', import.meta.url), 'utf8')
  .replace(/^import .*;\n/gm, '').replaceAll('import.meta.url', JSON.stringify('file:///fixture/scripts/spec/qualify-modular-agon-slice9.mjs'));
const releaseArtifactCount = JSON.parse(readFileSync(new URL('../../docs/specs/evidence/modular-agon-release-set.json', import.meta.url), 'utf8')).artifactCount;

it.each([[3, true], [1, true], [3, false], [0, false]] as const)(
  'runs qualification self-tests independently of stored platform=%i and performance=%s', (passed, performancePassed) => {
    const exited = new Error('self-test exited');
    let exitCode: number | undefined;
    expect(() => runInNewContext(qualificationSource, {
      URL, join,
      process: { argv: ['--self-test'], env: {}, exit: (code: number) => { exitCode = code; throw exited; } },
      tmpdir: () => '/fixture/tmp', mkdtempSync: (prefix: string) => prefix + 'unique', rmSync() {},
      collectSubjectContamination: () => ({ ignored: [], untracked: [], unstaged: [] }),
      isSourceBearingPath: () => false,
      hashGitSubject: () => 'sha256:fixture',
      validateStoredSubjectBoundReview: () => ({ passed: false }),
      validateDependencyGraph: () => ({ duplicateEdges: [], uniqueEdges: 153 }),
      readFileSync: (path: string) => {
        if (path.endsWith('package-map.json')) return JSON.stringify({ packages: Array.from({ length: 49 }, (_, i) => ({ class: i < 36 ? 'user-toggleable-mod-package' : 'support' })) });
        if (path.endsWith('ownership.json')) return JSON.stringify({ assignments: Array(872).fill(null) });
        if (path.endsWith('release-set.json')) return JSON.stringify({ artifactCount: releaseArtifactCount });
        if (path.endsWith('physical-cutover.json')) return JSON.stringify({ counts: { physical: 36 } });
        if (path.endsWith('platform-matrix.json')) return JSON.stringify({ summary: { passed, externallyBlocked: 12 - passed, failed: 0 } });
        if (path.endsWith('-performance.json')) return JSON.stringify({ passed: performancePassed });
        throw new Error(`unexpected fixture read: ${path}`);
      },
      spawnSync: () => { throw new Error('self-test must not execute qualification commands'); },
      console: { log() {} },
    })).toThrow(exited);
    expect(exitCode).toBe(0);
  },
);

it.each([false, true])('requires child PATH node to resolve to the selected override (matching=%s)', (matching) => {
  let receipt: { passed: boolean } | undefined;
  const process = { platform: 'linux', arch: 'x64', version: 'v22.0.0', execPath: '/fixture/node22', env: {}, argv: [], exitCode: 0 };
  runInNewContext(source, {
    process, dirname, join, resolve,
    existsSync: (path: string) => path === process.execPath,
    realpathSync: (path: string) => matching || path === process.execPath ? '/real/node22' : '/real/node26',
    readFileSync: () => JSON.stringify({ version: '1.0.0' }),
    tmpdir: () => '/fixture/tmp', mkdtempSync: () => '/fixture/tmp/unique', rmSync() {},
    writeFileSync: (_path: string, value: string) => { receipt = JSON.parse(value); },
    spawnSync: (_path: string, args: string[]) => ({ status: 0, stdout: args[0] === '-p'
      ? JSON.stringify({ version: process.version, platform: process.platform, arch: process.arch }) : '1.0.0', stderr: '' }),
    console: { log() {} },
  });
  expect(receipt!.passed).toBe(matching);
});

it.each([false, true])('binds a cached executable to the verified archive (matching=%s)', (matching) => {
  let receipt: { passed: boolean } | undefined;
  const executable = '/private/tmp/agon-node-matrix/node-v22.23.2-darwin-arm64/bin/node';
  const archive = '/private/tmp/node-v22.23.2-darwin-arm64.tar.gz';
  const process = { platform: 'darwin', arch: 'arm64', version: 'v26.3.0', execPath: '/missing', env: {}, argv: [], exitCode: 0 };
  runInNewContext(source, {
    process, basename, dirname, join, resolve, realpathSync: (path: string) => path,
    existsSync: (path: string) => path === executable || path === archive,
    readFileSync: (path: string) => path === archive ? 'archive-bytes' : path === executable ? (matching ? 'original-node' : 'changed-node') : JSON.stringify({ version: '1.0.0' }),
    createHash: () => ({ update: (bytes: string) => ({ digest: () => bytes === 'archive-bytes' ? '61130f394c1630d211dd50aecc4353d379480f36d3ac913cd85dbba1aed585c6' : bytes }) }),
    tmpdir: () => '/fixture/tmp', mkdtempSync: () => '/fixture/tmp/unique', rmSync() {},
    writeFileSync: (_path: string, value: string) => { receipt = JSON.parse(value); },
    spawnSync: (path: string, args: string[]) => {
      if (path === 'tar') {
        expect(args).toEqual(['-xOf', archive, 'node-v22.23.2-darwin-arm64/bin/node']);
        return { status: 0, stdout: 'original-node', stderr: '' };
      }
      return { status: 0, stdout: args[0] === '-p' ? JSON.stringify({ version: 'v22.23.2', platform: 'darwin', arch: 'arm64' }) : '1.0.0', stderr: '' };
    },
    console: { log() {} },
  });
  expect(receipt!.passed).toBe(matching);
});

it.each([
  [0, false, true, 'valid'], [1, true, true, 'valid'], [3, false, true, 'valid'],
  [3, true, true, 'valid'], [3, true, false, 'valid'],
  ...['aggregate', 'step', 'child', 'missing', 'reordered', 'malformed', 'contradictory',
    'load-exit', 'load-missing', 'load-malformed', 'load-false', 'load-short', 'load-control', 'load-identity',
    'release-missing', 'release-extra']
    .map(fault => [3, true, true, fault] as const),
] as const)('qualifies fresh %i-cell coverage with native attestation=%s and fresh performance=%s (%s)', (passed, native, performancePassed, fault) => {
  let receipt: { passed: boolean; coverage: { platformPassed: number }; cleanCheckoutSteps: Array<{ id: string; evidence?: { steps: Array<{ evidence: { diagnostic?: string } }> } }> } | undefined;
  const fresh = { status: 'completed', passed: passed > 0, runnerProvenance: native ? 'caller-attested-native' : 'diagnostic',
    cells: Array.from({ length: passed }, () => ({ status: 'passed', native })),
    summary: { passed, externallyBlocked: 12 - passed, failed: 0 } };
  runInNewContext(qualificationSource, {
    URL, join, process: { argv: ['--run-clean', ...(native ? ['--native-runner'] : [])], env: {}, exitCode: 0 },
    tmpdir: () => '/fixture/tmp', mkdtempSync: (prefix: string) => prefix + 'unique', rmSync() {},
    collectSubjectContamination: () => ({ ignored: [], untracked: [], unstaged: [] }),
    isSourceBearingPath: () => false,
    hashGitSubject: () => 'sha256:fixture',
    validateStoredSubjectBoundReview: () => ({ passed: true }),
    validateDependencyGraph: () => ({ duplicateEdges: [], uniqueEdges: 153 }),
    loadEvidencePasses,
    readFileSync: (path: string) => {
      if (path.endsWith('package-map.json')) return JSON.stringify({ packages: Array.from({ length: 49 }, (_, i) => ({ class: i < 36 ? 'user-toggleable-mod-package' : 'support' })) });
      if (path.endsWith('ownership.json')) return JSON.stringify({ assignments: Array(872).fill(null) });
      if (path.endsWith('release-set.json')) return JSON.stringify({ artifactCount: releaseArtifactCount
        + (fault === 'release-missing' ? -1 : fault === 'release-extra' ? 1 : 0) });
      if (path.endsWith('physical-cutover.json')) return JSON.stringify({ counts: { physical: 36 } });
      if (path.endsWith('platform-matrix.json')) return JSON.stringify({ summary: { passed: 3, externallyBlocked: 9, failed: 0 } });
      if (path.endsWith('-performance.json')) return JSON.stringify({ passed: true });
      throw new Error(`unexpected fixture read: ${path}`);
    },
    spawnSync: (_command: string, args: string[]) => {
      if (args[0] === 'scripts/spec/measure-modular-load.mjs') {
        const evidence = loadEvidenceFixture();
        if (fault === 'load-false') evidence.passed = false;
        if (fault === 'load-short') evidence.phases[1].durationMs = 100;
        if (fault === 'load-control') evidence.phases[1].controls.cancelledEngineGone = false;
        if (fault === 'load-identity') evidence.platform = 'other';
        return { status: fault === 'load-exit' ? 1 : 0, stderr: '', stdout: fault === 'load-malformed' ? '{'
          : fault === 'load-missing' ? '{}' : JSON.stringify(evidence) };
      }
      if (args[0] === 'scripts/spec/measure-modular-release.mjs') {
        const steps = ['1a', '2', '3', '4', '5', '6', '7', '8'].map(slice => ({ slice,
          passed: performancePassed && fault !== 'step', evidence: { passed: performancePassed && fault !== 'child',
            budgets: { rssGreen: fault !== 'contradictory' }, diagnostic: slice === '1a' ? 'early failure' : 'padding'.repeat(1000) } }));
        if (fault === 'missing') steps.pop();
        if (fault === 'reordered') steps.reverse();
        return { status: performancePassed ? 0 : 1, stderr: '', stdout: fault === 'malformed' ? '{'
          : JSON.stringify({ passed: performancePassed && fault !== 'aggregate', steps }) };
      }
      if (args[0] === 'scripts/spec/verify-modular-platform-matrix.mjs') {
        expect(args.includes('--native-runner')).toBe(native);
        return { status: 0, stderr: '', stdout: JSON.stringify(fresh) };
      }
      return { status: 0, stderr: '', stdout: '' };
    },
    console: { log: (text: string) => { receipt = JSON.parse(text); } },
  });
  expect(receipt!.coverage.platformPassed).toBe(passed);
  expect(receipt!.passed).toBe(passed === 3 && native && performancePassed && fault === 'valid');
  if (fault === 'valid') expect(receipt!.cleanCheckoutSteps.find(step => step.id === 'performance-release')?.evidence?.steps[0].evidence.diagnostic).toBe('early failure');
});

it.each([['linux', 'x64', 'v26.3.0', false], ['linux', 'arm64', 'v26.3.0', false], ['darwin', 'x64', 'v26.3.0', false], ['darwin', 'arm64', 'v26.3.0', false],
  ['linux', 'x64', 'v22.23.2', false], ['linux', 'arm64', 'v24.20.0', false], ['darwin', 'arm64', 'v26.3.0', true]] as const)(
  'attributes %s/%s/%s runtime evidence without inferring native hardware (attested=%s)', (platform, arch, version, native) => {
    let receipt: { cells: Array<{ os: string; arch: string; nodeMajor: number; status: string; native?: boolean }> } | undefined;
    const process = { platform, arch, version, execPath: '/fixture/node', env: { PATH: '/fixture' }, argv: native ? ['--native-runner'] : [], exitCode: 0 };
    runInNewContext(source, {
      process, dirname, join, resolve, realpathSync: (path: string) => path,
      existsSync: (path: string) => path === process.execPath,
      readFileSync: () => JSON.stringify({ version: '1.0.0' }),
      tmpdir: () => '/fixture/tmp', mkdtempSync: () => '/fixture/tmp/unique', rmSync() {},
      writeFileSync: (_path: string, value: string) => { receipt = JSON.parse(value); },
      spawnSync: (_path: string, args: string[]) => ({ status: 0, stdout: args[0] === '-p'
        ? JSON.stringify({ version, platform, arch }) : '1.0.0', stderr: '' }),
      console: { log() {} },
    });
    expect(receipt).toBeDefined();
    const passed = receipt!.cells.filter(cell => cell.status === 'passed');
    expect(passed).toEqual([expect.objectContaining({ os: platform, arch, nodeMajor: Number(version.slice(1).split('.')[0]), native })]);
    expect(receipt!.cells).toHaveLength(12);
    expect(new Set(receipt!.cells.map(cell => `${cell.os}/${cell.arch}/${cell.nodeMajor}`)).size).toBe(12);
    expect(receipt!.cells.filter(cell => cell.os !== platform || cell.arch !== arch)
      .every(cell => cell.status === 'externally-blocked' && !cell.native)).toBe(true);
  },
);

it('does not certify an overridden runtime with a different architecture', () => {
  let receipt: { passed: boolean; cells: Array<{ status: string; native?: boolean; reason?: string }> } | undefined;
  const calls: string[][] = [];
  const process = { platform: 'linux', arch: 'arm64', version: 'v26.3.0', execPath: '/missing', env: { AGON_NODE22: '/fixture/node22' }, argv: [], exitCode: 0 };
  runInNewContext(source, {
    process,
    dirname, join, resolve,
    existsSync: (path: string) => path === '/fixture/node22',
    readFileSync: (path: string) => {
      expect(path).toBe('/fixture/packages/cli/package.json');
      return JSON.stringify({ version: '1.0.0' });
    },
    writeFileSync: (_path: string, value: string) => { receipt = JSON.parse(value); },
    spawnSync: (_path: string, args: string[]) => {
      calls.push(args);
      return { status: 0, stdout: JSON.stringify({ version: 'v22.23.2', platform: 'linux', arch: 'x64' }), stderr: '' };
    },
    console: { log() {} },
  });
  expect(calls).toHaveLength(1);
  expect(calls[0][0]).toBe('-p');
  expect(receipt!.cells.every(cell => cell.status === 'externally-blocked' && !cell.native)).toBe(true);
  expect(receipt!.cells.some(cell => cell.reason?.includes('does not match'))).toBe(true);
  expect(receipt!.passed).toBe(false);
  expect(process.exitCode).toBe(1);
});

it.each(['11.0.0', '1.0.0-beta', '[log] 11.0.0', 'unit-failure', 'cli-failure', 'cleanup-failure', '1.0.0', '[log] 1.0.0'])(
  'checks exact version and exit status, with isolated cleanup (%s)', (output) => {
    let receipt: { passed: boolean; cells: unknown[] } | undefined;
    const homes: string[] = [];
    const removed: string[] = [];
    const process = { platform: 'linux', arch: 'x64', version: 'v26.3.0', execPath: '/fixture/node', env: {}, argv: [], exitCode: 0 };
    runInNewContext(source, {
      process, dirname, join, resolve, realpathSync: (path: string) => path,
      existsSync: (path: string) => path === '/fixture/node',
      readFileSync: () => JSON.stringify({ version: '1.0.0' }),
      writeFileSync: (_path: string, value: string) => { receipt = JSON.parse(value); },
      tmpdir: () => '/fixture/tmp',
      mkdtempSync: (prefix: string) => { expect(prefix).toBe('/fixture/tmp/agon-s9-platform-'); return prefix + 'unique'; },
      rmSync: (path: string) => { removed.push(path); if (output === 'cleanup-failure') throw new Error('cleanup failed'); },
      spawnSync: (_path: string, args: string[], options: { env?: { AGON_HOME: string } }) => {
        if (args[0] === '-p') return { status: 0, stdout: JSON.stringify({ version: process.version, platform: process.platform, arch: process.arch }), stderr: '' };
        homes.push(options.env!.AGON_HOME);
        const unit = args[0].endsWith('/vitest.mjs');
        expect(args[0]).toBe(unit ? '/fixture/node_modules/vitest/vitest.mjs' : '/fixture/packages/cli/dist/index.js');
        return { status: output === (unit ? 'unit-failure' : 'cli-failure') ? 1 : 0, stdout: output, stderr: '' };
      },
      console: { log() {} },
    });
    const valid = output === '1.0.0' || output === '[log] 1.0.0';
    expect(receipt!.passed).toBe(valid);
    expect(receipt!.cells).toHaveLength(12);
    expect(process.exitCode).toBe(valid ? 0 : 1);
    expect(homes).toEqual(['/fixture/tmp/agon-s9-platform-unique', '/fixture/tmp/agon-s9-platform-unique']);
    expect(removed).toEqual(['/fixture/tmp/agon-s9-platform-unique']);
  },
);

it.each(['probe-error', 'wrong-major', 'malformed-json', 'package-error'])(
  'replaces old passing evidence when validation fails (%s)', (failure) => {
    let receipt = { passed: true, cells: [] as Array<{ status: string; reason?: string }> };
    const process = { platform: 'linux', arch: 'x64', version: 'v26.3.0', execPath: '/fixture/node', env: {}, argv: [], exitCode: 0 };
    const run = () => runInNewContext(source, {
      process, dirname, join, resolve,
      existsSync: (path: string) => path === '/fixture/node',
      readFileSync: () => {
        if (failure === 'package-error') throw new Error('package unreadable');
        return JSON.stringify({ version: '1.0.0' });
      },
      writeFileSync: (_path: string, value: string) => { receipt = JSON.parse(value); },
      spawnSync: (_path: string, args: string[]) => {
        expect(args[0]).toBe('-p');
        return { status: failure === 'probe-error' ? null : 0,
          stdout: failure === 'malformed-json' ? '{' : JSON.stringify({ version: 'v22.0.0', platform: 'linux', arch: 'x64' }) };
      },
      console: { log() {} },
    });
    if (failure === 'package-error') expect(run).toThrow('package unreadable');
    else {
      expect(run).not.toThrow();
      expect(receipt.cells.some(cell => cell.status === 'failed' && cell.reason)).toBe(true);
      expect(process.exitCode).toBe(1);
    }
    expect(receipt.passed).toBe(false);
  },
);
