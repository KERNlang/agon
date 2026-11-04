import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { removeSessionWorktree } from '../../packages/core/src/blocks/worktree-session.js';
import { createConquerIsolation } from '../../packages/forge/src/conquer.js';
import { createConquerIsolation as createOwnedIsolation } from '../../packages/mod-conquer/src/isolation.js';
import { createSessionWorktree as createOwnedSession } from '../../packages/support-worktree/src/worktree-session.js';
import { sessionRuntime } from '../../packages/mod-worktrees/src/runtime.js';

describe('Conquer worktree isolation', () => {
  let base: string;
  let repo: string;
  let previousHome: string | undefined;

  const git = (args: string[], cwd = repo): string => execFileSync('git', args, { cwd, encoding: 'utf-8' }).trim();

  beforeEach(() => {
    previousHome = process.env.AGON_HOME;
    base = mkdtempSync(join(tmpdir(), 'agon-conquer-isolation-'));
    process.env.AGON_HOME = join(base, 'agon-home');
    repo = join(base, 'repo');
    mkdirSync(repo, { recursive: true });
    git(['init', '-q']);
    git(['config', 'user.email', 'test@agon.dev']);
    git(['config', 'user.name', 'Agon Test']);
    writeFileSync(join(repo, 'README.md'), 'base\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'base']);
  });

  afterEach(() => {
    if (previousHome === undefined) delete process.env.AGON_HOME;
    else process.env.AGON_HOME = previousHome;
    rmSync(base, { recursive: true, force: true });
  });

  it('keeps source WIP untouched while mutations land on a named branch', () => {
    writeFileSync(join(repo, 'source-wip.txt'), 'keep me\n');
    const isolation = createConquerIsolation('Build a CSV importer', repo, 'test-run');

    expect(isolation.branch).toBe('conquer/build-a-csv-importer-test-run');
    expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], isolation.path)).toBe(isolation.branch);
    expect(() => readFileSync(join(isolation.path, 'source-wip.txt'), 'utf-8')).toThrow();

    writeFileSync(join(isolation.path, 'README.md'), 'builder change\n');
    writeFileSync(join(isolation.path, 'built.txt'), 'isolated\n');

    expect(readFileSync(join(repo, 'README.md'), 'utf-8')).toBe('base\n');
    expect(readFileSync(join(repo, 'source-wip.txt'), 'utf-8')).toBe('keep me\n');
    expect(git(['status', '--porcelain'])).toBe('?? source-wip.txt');

    expect(removeSessionWorktree(repo, isolation.branch, true)).toBe(true);
  });

  it('overlays installed dependencies and build artifacts for the gate', () => {
    mkdirSync(join(repo, 'packages', 'demo'), { recursive: true });
    writeFileSync(join(repo, 'packages', 'demo', 'package.json'), '{"name":"demo"}\n');
    git(['add', '-A']);
    git(['commit', '-q', '-m', 'add workspace package']);
    mkdirSync(join(repo, 'node_modules', 'example'), { recursive: true });
    mkdirSync(join(repo, 'packages', 'demo', 'dist'), { recursive: true });
    writeFileSync(join(repo, 'node_modules', 'example', 'index.js'), 'module.exports = 42;\n');
    writeFileSync(join(repo, 'packages', 'demo', 'dist', 'artifact.js'), 'built\n');

    const isolation = createConquerIsolation('Build with dependencies', repo, 'overlay-test');

    expect(readFileSync(join(isolation.path, 'node_modules', 'example', 'index.js'), 'utf-8')).toContain('42');
    expect(readFileSync(join(isolation.path, 'packages', 'demo', 'dist', 'artifact.js'), 'utf-8')).toBe('built\n');
    expect(removeSessionWorktree(repo, isolation.branch, true)).toBe(true);
  });

  it.each(['legacy', 'modular'])('refuses to reuse a prior Conquer branch through %s without changing its commits', runtime => {
    const create = () => runtime === 'legacy'
      ? createConquerIsolation('Build a feature', repo, 'same-run')
      : createOwnedIsolation('Build a feature', repo, {
        repoRoot: () => repo, createSessionWorktree: options => createOwnedSession(options, sessionRuntime),
      }, 'same-run');
    const first = create();
    writeFileSync(join(first.path, 'prior.txt'), 'previous work\n');
    git(['add', 'prior.txt'], first.path);
    git(['commit', '-q', '-m', 'prior result'], first.path);
    const prior = git(['rev-parse', 'HEAD'], first.path);
    expect(removeSessionWorktree(repo, first.branch, true)).toBe(true);
    expect(create).toThrow(/already exists/);
    expect(git(['rev-parse', first.branch])).toBe(prior);
    expect(git(['worktree', 'list', '--porcelain'])).not.toContain(first.path);
  });

  it('keeps a physical Conquer worktree discoverable after process termination', async () => {
    const output = join(base, 'run');
    mkdirSync(output);
    const script = `
      import { writeFileSync } from 'node:fs';
      import { join } from 'node:path';
      import { createMod, createConquerHostServices } from ${JSON.stringify(new URL('../../packages/mod-conquer/dist/index.js', import.meta.url).href)};
      import { repoRoot, createSessionWorktree } from ${JSON.stringify(new URL('../../packages/core/dist/index.js', import.meta.url).href)};
      const output = ${JSON.stringify(output)};
      const services = {
        logger: { debug: async () => {} }, receipts: { record: async () => 'fixture' },
        runs: {
          start: async () => ({ id: 'crash-run', path: output, mode: 'conquer', startedAt: new Date().toISOString() }),
          writeArtifact: async (_run, name, content) => writeFileSync(join(output, name), content),
          finish: async () => {},
        },
        conquer: createConquerHostServices({
          worktrees: { repoRoot, createSessionWorktree },
          openRegistry: () => ({ get: id => ({ id }) }),
          createAdapter: () => ({ dispatch: async () => { throw new Error('unexpected dispatch'); }, isAvailable: async () => true, getVersion: async () => null }),
          rankCritics: () => [], contextSpine: async () => '', captureAuthority: () => () => {},
        }),
        engines: {
          listActive: async () => ['builder'],
          dispatch: async (_id, _prompt, context) => {
            writeFileSync(join(context.cwd, 'partial.txt'), 'recover this\\n');
            process.send({ path: context.cwd });
            await new Promise(() => { setInterval(() => {}, 1000); });
          },
        },
      };
      let command;
      await (await createMod(services)).activate(new Proxy({}, { get: (_target, method) => (...args) => {
        if (method === 'command' && args[0] === 'cli') command = args[1];
        return () => {};
      } }));
      await command.run({ task: 'recover process', gate: 'true', maxTurns: '1' }, {
        invocationId: 'crash-run', cwd: ${JSON.stringify(repo)}, platform: 'darwin-arm64', signal: new AbortController().signal, config: {},
      });
    `;
    const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
      cwd: repo, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr += String(chunk); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const ready = await new Promise<{ path: string }>((resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Conquer fixture did not start: ${stderr}`)), 5000);
        child.once('error', reject);
        child.once('exit', code => reject(new Error(`Conquer fixture exited ${code}: ${stderr}`)));
        child.once('message', message => resolve(message as { path: string }));
      });
      clearTimeout(timer);
      child.kill('SIGTERM');
      await Promise.race([closed, new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Conquer fixture did not terminate')), 5000);
      })]);
      clearTimeout(timer);
      const saved = JSON.parse(readFileSync(join(output, 'worktree.json'), 'utf8'));
      expect(saved.path).toBe(ready.path);
      expect(saved.branch).toBe('conquer/recover-process-crash-run');
      expect(readFileSync(join(saved.path, 'partial.txt'), 'utf8')).toBe('recover this\n');
      expect(git(['branch', '--show-current'], saved.path)).toBe(saved.branch);
      expect(git(['worktree', 'list', '--porcelain'])).toContain(saved.path);
      expect(removeSessionWorktree(repo, saved.branch, true)).toBe(true);
    } finally {
      clearTimeout(timer);
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
    }
  }, 15000);
});
