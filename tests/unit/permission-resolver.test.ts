import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock ONLY the config I/O — rule evaluation, path resolution, and command
// classification stay real. persistPermissionRule must never touch the
// developer's actual ~/.agon/config.json from a unit test.
const { loadConfigMock, configSetMock } = vi.hoisted(() => ({
  loadConfigMock: vi.fn().mockReturnValue({}),
  configSetMock: vi.fn(),
}));
vi.mock('@kernlang/agon-core', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@kernlang/agon-core');
  return { ...actual, loadConfig: loadConfigMock, configSet: configSetMock };
});

import {
  addSessionPermissionRule,
  authorizeResolvedTaskAction,
  buildEffectivePermissionRuleSet,
  clampDelegatedPermissionMode,
  clearSessionPermissionRules,
  cycleAgonPermissionMode,
  describeAgonPermissionMode,
  fileTargetInsideWorkspace,
  getSessionPermissionRules,
  isLeaselessBashBoundary,
  isPermissionHardDeny,
  isSensitivePermissionPath,
  resolveAgonPermissionMode,
  resolvePermissionDecision,
  synthesizePermissionRule,
  validateSynthesizedRule,
} from '../../packages/cli/src/generated/cesar/permission-resolver.js';
import { persistPermissionRule } from '../../packages/cli/src/generated/cesar/permission-resolver.js';
import { createTaskExecutionLease } from '../../packages/cli/src/generated/cesar/task-execution-lease.js';

const WS = process.cwd();

const cfg = (overrides: Record<string, unknown> = {}) => ({
  permissionMode: 'smart',
  allowedCommands: [],
  toolPermissions: {},
  permissions: {},
  ...overrides,
});

const request = (overrides: Record<string, unknown> = {}) => ({
  tool: 'Bash',
  target: 'npm run build',
  cwd: WS,
  source: 'native' as const,
  config: cfg(),
  ...overrides,
});

beforeEach(() => {
  clearSessionPermissionRules();
  loadConfigMock.mockReturnValue({});
  configSetMock.mockReset();
});

describe('resolveAgonPermissionMode', () => {
  it('honors an explicit agonPermissionMode', () => {
    expect(resolveAgonPermissionMode(cfg({ agonPermissionMode: 'auto' }))).toBe('auto');
    expect(resolveAgonPermissionMode(cfg({ agonPermissionMode: 'ask' }))).toBe('ask');
  });
  it('migrates legacy permissionMode when agonPermissionMode is unset or invalid', () => {
    expect(resolveAgonPermissionMode(cfg({ permissionMode: 'auto' }))).toBe('auto');
    expect(resolveAgonPermissionMode(cfg({ permissionMode: 'smart' }))).toBe('auto-edit');
    expect(resolveAgonPermissionMode(cfg({ permissionMode: 'ask' }))).toBe('ask');
    expect(resolveAgonPermissionMode(cfg({ permissionMode: 'deny-all' }))).toBe('ask');
    expect(resolveAgonPermissionMode(cfg({ agonPermissionMode: 'yolo', permissionMode: 'ask' }))).toBe('ask');
    expect(resolveAgonPermissionMode(cfg({ agonPermissionMode: '' }))).toBe('auto-edit');
  });
});

describe('mode helpers', () => {
  it('cycles ask → auto-edit → auto → ask', () => {
    expect(cycleAgonPermissionMode('ask')).toBe('auto-edit');
    expect(cycleAgonPermissionMode('auto-edit')).toBe('auto');
    expect(cycleAgonPermissionMode('auto')).toBe('ask');
  });
  it('clamps delegated runs to at least auto-edit', () => {
    expect(clampDelegatedPermissionMode('ask')).toBe('auto-edit');
    expect(clampDelegatedPermissionMode('auto-edit')).toBe('auto-edit');
    expect(clampDelegatedPermissionMode('auto')).toBe('auto');
  });
  it('describes every mode with a label and hint', () => {
    for (const mode of ['ask', 'auto-edit', 'auto'] as const) {
      const described = describeAgonPermissionMode(mode);
      expect(described.label.length).toBeGreaterThan(0);
      expect(described.hint.length).toBeGreaterThan(0);
    }
  });
  it('flags deny-all as hard deny', () => {
    expect(isPermissionHardDeny(cfg({ permissionMode: 'deny-all' }))).toBe(true);
    expect(isPermissionHardDeny(cfg())).toBe(false);
  });
});

describe('resolvePermissionDecision — deny stages', () => {
  it('deny-all wins over an allow rule', () => {
    const r = resolvePermissionDecision(request({
      config: cfg({ permissionMode: 'deny-all', permissions: { allow: ['Bash(npm run:*)'] } }),
    }));
    expect(r.decision).toBe('deny');
    expect(r.stage).toBe('hard-deny');
  });
  it('toolPermissions deny blocks the tool', () => {
    const r = resolvePermissionDecision(request({ config: cfg({ toolPermissions: { Bash: 'deny' } }) }));
    expect(r).toMatchObject({ decision: 'deny', stage: 'tool-permissions' });
  });
  it('a deny rule wins over an allow rule for the same command', () => {
    const r = resolvePermissionDecision(request({
      target: 'git push origin main',
      config: cfg({ permissions: { allow: ['Bash(git push:*)'], deny: ['Bash(git push:*)'] } }),
    }));
    expect(r).toMatchObject({ decision: 'deny', stage: 'deny-rule' });
  });
  it('lease workspace escape denies file mutations outside mode auto', () => {
    const lease = createTaskExecutionLease('fix the bug', true, WS);
    const r = resolvePermissionDecision(request({ tool: 'Edit', target: '/etc/passwd', lease }));
    expect(r).toMatchObject({ decision: 'deny', stage: 'lease', reason: 'workspace_escape' });
    expect(resolvePermissionDecision(request({
      tool: 'Edit', target: '/etc/passwd', lease, config: cfg({ agonPermissionMode: 'auto-edit' }),
    }))).toMatchObject({ decision: 'deny', reason: 'workspace_escape' });
  });
  it('mode auto turns a lease workspace escape into an ask instead of a silent dead end', () => {
    // CC-parity contract: in auto the user must be able to consent to an
    // out-of-workspace write rather than watch the turn fail. Every other mode
    // keeps the hard deny (see the test above).
    const lease = createTaskExecutionLease('fix the bug', true, WS);
    const r = resolvePermissionDecision(request({
      tool: 'Edit', target: '/etc/passwd', lease, config: cfg({ agonPermissionMode: 'auto' }),
    }));
    expect(r).toMatchObject({ decision: 'ask', stage: 'lease', reason: 'workspace_escape' });
    const shellEscape = resolvePermissionDecision(request({
      target: 'printf boom > /etc/hosts', lease, config: cfg({ agonPermissionMode: 'auto' }),
    }));
    expect(shellEscape).toMatchObject({ decision: 'ask', reason: 'workspace_escape' });
  });
});

describe('resolvePermissionDecision — allow sources', () => {
  it('an allow rule auto-approves and beats the lease destructive boundary', () => {
    const lease = createTaskExecutionLease('build the feature', true, WS);
    const r = resolvePermissionDecision(request({
      target: 'git push --force origin feature',
      lease,
      config: cfg({ permissions: { allow: ['Bash(git push:*)'] } }),
    }));
    expect(r).toMatchObject({ decision: 'allow', stage: 'allow-rule' });
  });
  it('legacy allowedCommands base-prefix still auto-approves routine commands', () => {
    const r = resolvePermissionDecision(request({
      target: 'npm run build',
      config: cfg({ permissionMode: 'ask', allowedCommands: ['npm run'] }),
    }));
    expect(r).toMatchObject({ decision: 'allow', stage: 'allowed-commands' });
  });
  it('legacy bare tokens and tool-level allows never cover a destructive boundary', () => {
    // The boundary class narrowed to destructive-only, but the ordering rule is
    // unchanged: a blunt allow source must not swallow it.
    const lease = createTaskExecutionLease('build the feature', true, WS);
    const viaToken = resolvePermissionDecision(request({
      target: 'git push --force origin main',
      lease,
      config: cfg({ allowedCommands: ['git'] }),
    }));
    expect(viaToken).toMatchObject({ decision: 'ask', reason: 'destructive_boundary' });
    const viaToolAllow = resolvePermissionDecision(request({
      target: 'git push --force origin main',
      lease,
      config: cfg({ toolPermissions: { Bash: 'allow' } }),
    }));
    expect(viaToolAllow).toMatchObject({ decision: 'ask', reason: 'destructive_boundary' });
    const leaseless = resolvePermissionDecision(request({
      target: 'npm publish',
      config: cfg({ allowedCommands: ['npm'] }),
    }));
    expect(leaseless).toMatchObject({ decision: 'ask', reason: 'dangerous_boundary' });
  });
  it('the session allowlist auto-approves Bash', () => {
    const r = resolvePermissionDecision(request({
      target: 'cargo fmt --all',
      config: cfg({ permissionMode: 'ask' }),
      sessionAllowList: ['cargo'],
    }));
    expect(r).toMatchObject({ decision: 'allow', stage: 'session-allowlist' });
  });
  it('a session rule added via addSessionPermissionRule auto-approves', () => {
    expect(addSessionPermissionRule('Bash(cargo fmt:*)')).toBe(true);
    const r = resolvePermissionDecision(request({
      target: 'cargo fmt --all',
      config: cfg({ permissionMode: 'ask' }),
    }));
    expect(r).toMatchObject({ decision: 'allow', stage: 'allow-rule' });
    clearSessionPermissionRules();
    expect(getSessionPermissionRules()).toEqual([]);
  });
  it('lease AUTO approves routine work', () => {
    const lease = createTaskExecutionLease('refactor the parser', true, WS);
    const r = resolvePermissionDecision(request({ target: 'npm run build', lease, config: cfg({ permissionMode: 'ask' }) }));
    expect(r).toMatchObject({ decision: 'allow', stage: 'lease', reason: 'routine_auto' });
  });
});

describe('resolvePermissionDecision — boundary asks survive every mode', () => {
  it('a destructive lease boundary asks even in auto mode, while a plain push runs', () => {
    const lease = createTaskExecutionLease('build the feature', true, WS);
    const config = cfg({ agonPermissionMode: 'auto' });
    expect(resolvePermissionDecision(request({ target: 'git push --force origin main', lease, config })))
      .toMatchObject({ decision: 'ask', stage: 'lease', reason: 'destructive_boundary' });
    expect(resolvePermissionDecision(request({ target: 'dropdb agon_dev', lease, config })))
      .toMatchObject({ decision: 'ask', reason: 'destructive_boundary' });
    // …and the boundary the CC-parity change deliberately removed:
    expect(resolvePermissionDecision(request({ target: 'git push origin main', lease, config })).decision).toBe('allow');
  });
  it('a leaseless delegated push asks even at the auto floor', () => {
    const r = resolvePermissionDecision(request({
      target: 'git push origin main',
      source: 'delegated',
      cwd: '',
      config: cfg({ agonPermissionMode: 'auto' }),
    }));
    expect(r).toMatchObject({ decision: 'ask', reason: 'dangerous_boundary' });
  });
  it('isLeaselessBashBoundary catches publishing and mutating curl', () => {
    expect(isLeaselessBashBoundary('npm publish')).toBe(true);
    expect(isLeaselessBashBoundary('git push origin main')).toBe(true);
    expect(isLeaselessBashBoundary('npm run build')).toBe(false);
  });
});

describe('resolvePermissionDecision — mode policy', () => {
  it('ask mode: read-only allows, mutations ask', () => {
    const config = cfg({ agonPermissionMode: 'ask' });
    expect(resolvePermissionDecision(request({ target: 'git status', config })).decision).toBe('allow');
    expect(resolvePermissionDecision(request({ tool: 'Read', target: 'src/index.ts', config })).decision).toBe('allow');
    expect(resolvePermissionDecision(request({ target: 'npm run build', config })).decision).toBe('ask');
    expect(resolvePermissionDecision(request({ tool: 'Edit', target: 'src/index.ts', config })).decision).toBe('ask');
  });
  it('auto-edit mode: workspace file edits allow, Bash mutations ask', () => {
    const config = cfg({ agonPermissionMode: 'auto-edit' });
    expect(resolvePermissionDecision(request({ tool: 'Edit', target: 'src/index.ts', config })).decision).toBe('allow');
    expect(resolvePermissionDecision(request({ tool: 'Write', target: `${WS}/notes.md`, config })).decision).toBe('allow');
    expect(resolvePermissionDecision(request({ tool: 'Edit', target: '/etc/passwd', config })).decision).toBe('ask');
    expect(resolvePermissionDecision(request({ target: 'npm run build', config })).decision).toBe('ask');
    expect(resolvePermissionDecision(request({ target: 'git diff', config })).decision).toBe('allow');
  });
  it('auto mode allows routine mutations', () => {
    const config = cfg({ agonPermissionMode: 'auto' });
    expect(resolvePermissionDecision(request({ target: 'npm run build', config })).decision).toBe('allow');
    expect(resolvePermissionDecision(request({ tool: 'Edit', target: 'src/index.ts', config })).decision).toBe('allow');
  });
  it('delegated source in ask mode floor-clamps to auto-edit', () => {
    const config = cfg({ agonPermissionMode: 'ask' });
    expect(resolvePermissionDecision(request({ tool: 'Edit', target: 'src/index.ts', cwd: '', source: 'delegated', config })).decision).toBe('allow');
    expect(resolvePermissionDecision(request({ target: 'npm run build', cwd: '', source: 'delegated', config })).decision).toBe('ask');
    expect(resolvePermissionDecision(request({ target: 'git status', cwd: '', source: 'delegated', config })).decision).toBe('allow');
  });
  it('delegated file mutations never auto-approve absolute paths outside the workspace', () => {
    const config = cfg({ agonPermissionMode: 'ask' });
    expect(resolvePermissionDecision(request({ tool: 'Edit', target: '/etc/passwd', cwd: '', source: 'delegated', config })).decision).toBe('ask');
    expect(resolvePermissionDecision(request({ tool: 'Write', target: '../outside.ts', cwd: '', source: 'delegated', config })).decision).toBe('ask');
    expect(resolvePermissionDecision(request({ tool: 'Edit', target: '/etc/passwd', cwd: WS, source: 'delegated', config })).decision).toBe('ask');
  });
  it('auto mode without a lease still fences file mutations to the workspace', () => {
    const config = cfg({ agonPermissionMode: 'auto' });
    expect(resolvePermissionDecision(request({ tool: 'Edit', target: '/etc/passwd', config })).decision).toBe('ask');
    expect(resolvePermissionDecision(request({ tool: 'Edit', target: 'src/index.ts', config })).decision).toBe('allow');
  });
  it('same action resolves identically from native and self-turn sources', () => {
    const config = cfg({ agonPermissionMode: 'ask' });
    const native = resolvePermissionDecision(request({ tool: 'Edit', target: 'src/index.ts', config, source: 'native' }));
    const selfTurn = resolvePermissionDecision(request({ tool: 'Edit', target: 'src/index.ts', config, source: 'self-turn' }));
    expect(native.decision).toBe(selfTurn.decision);
  });
});

describe('the sensitive-path matcher (shared with Cesar self-turn approval)', () => {
  it('matches secrets by basename and hook directories by path', () => {
    for (const path of [
      `${WS}/.env`, `${WS}/.env.local`, `${WS}/config/credentials.json`, `${WS}/deploy.pem`,
      `${WS}/keys/deploy.key`, `${WS}/.ssh/id_rsa`, `${WS}/secrets.ts`,
      `${WS}/.git/hooks/pre-commit`, '.git/hooks/pre-push', `${WS}/.husky/pre-commit`,
      '.git\\hooks\\pre-commit',
    ]) {
      expect(isSensitivePermissionPath(path), path).toBe(true);
    }
    for (const path of [
      `${WS}/src/index.ts`, `${WS}/README.md`, `${WS}/.github/workflows/ci.yml`,
      `${WS}/src/environment.ts`, `${WS}/.gitignore`, '',
    ]) {
      expect(isSensitivePermissionPath(path), path).toBe(false);
    }
    // Config-tunable, and junk entries are ignored.
    expect(isSensitivePermissionPath(`${WS}/src/tokens.ts`, ['tokens.ts'])).toBe(true);
    expect(isSensitivePermissionPath(`${WS}/src/index.ts`, ['  ', ''])).toBe(false);
  });

  // VULN-3: the matcher used to read the RAW path string, so any spelling that
  // only resolves to a sensitive path evaded it. Canonicalize first.
  it('canonicalizes the path before matching so redundant segments cannot evade it', () => {
    for (const path of [
      // redundant separators / '.' segments (collapsed by path resolution)
      '.git//hooks/pre-commit', '.git/./hooks/pre-commit', './.git/hooks/pre-commit',
      'packages/../.git/hooks/pre-commit', 'packages/cli/../../.git/hooks/pre-commit',
      '.husky/./pre-commit', './.env', 'packages/../.env',
      // a trailing separator used to blank out the basename entirely
      '.env/',
    ]) {
      expect(isSensitivePermissionPath(path, undefined, WS), path).toBe(true);
    }
    // Canonicalization only ever ADDS coverage — ordinary paths stay routine.
    for (const path of ['./src/index.ts', 'packages/../README.md', 'packages/cli/src/index.ts']) {
      expect(isSensitivePermissionPath(path, undefined, WS), path).toBe(false);
    }
  });

  it('resolves symlink aliases of a sensitive directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-sensitive-'));
    try {
      mkdirSync(join(dir, '.git', 'hooks'), { recursive: true });
      writeFileSync(join(dir, '.env'), 'SECRET=1');
      symlinkSync(join(dir, '.git', 'hooks'), join(dir, 'scripts'), 'dir');
      symlinkSync(join(dir, '.env'), join(dir, 'settings.conf'), 'file');
      // Innocent-looking spellings that land on a hook directory / a secret.
      expect(isSensitivePermissionPath(join(dir, 'scripts', 'pre-commit'), undefined, dir)).toBe(true);
      expect(isSensitivePermissionPath('scripts/pre-commit', undefined, dir)).toBe(true);
      expect(isSensitivePermissionPath(join(dir, 'settings.conf'), undefined, dir)).toBe(true);
      // A plain file under the same tmp dir is still routine.
      writeFileSync(join(dir, 'notes.md'), '# notes');
      expect(isSensitivePermissionPath(join(dir, 'notes.md'), undefined, dir)).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('fences a canonicalization-evading hook edit through the resolver in auto-edit', () => {
    expect(resolvePermissionDecision(request({
      tool: 'Edit',
      target: '.git/./hooks/pre-commit',
      lease: createTaskExecutionLease('do the work', false, WS),
      config: cfg({ agonPermissionMode: 'auto-edit' }),
    }))).toMatchObject({ decision: 'ask', reason: 'sensitive_path' });
  });
});

// VULN-4: the resolver is the only stage that knows about sensitive paths, so
// its ask must survive the lease re-derivation inside authorizeResolvedTaskAction.
describe('authorizeResolvedTaskAction — the resolver ask is authoritative', () => {
  it('prompts for a sensitive-path edit under a one-shot /auto lease', async () => {
    const seen: string[] = [];
    const approve = async (evaluation: { reason: string }) => { seen.push(evaluation.reason); return false; };
    const outcome = await authorizeResolvedTaskAction(request({
      tool: 'Edit',
      target: '.git/hooks/pre-commit',
      // lease.autoMode=true + mode auto-edit is exactly the `/auto <task>` shape
      // that used to re-derive `routine_auto` and execute with no prompt.
      lease: createTaskExecutionLease('do the work', true, WS),
      config: cfg({ agonPermissionMode: 'auto-edit' }),
    }) as never, approve as never);
    expect(seen).toEqual(['sensitive_path']);
    expect(outcome).toMatchObject({ decision: 'deny', reason: 'user_denied' });
  });

  it('approving the sensitive edit once lets it through and does not re-prompt', async () => {
    let prompts = 0;
    const approve = async () => { prompts += 1; return true; };
    const req = request({
      tool: 'Edit',
      target: '.git/hooks/pre-commit',
      lease: createTaskExecutionLease('do the work', true, WS),
      config: cfg({ agonPermissionMode: 'auto-edit' }),
    });
    expect(await authorizeResolvedTaskAction(req as never, approve as never)).toMatchObject({ decision: 'allow' });
    expect(await authorizeResolvedTaskAction(req as never, approve as never)).toMatchObject({ decision: 'allow' });
    expect(prompts).toBe(1);
  });

  it('still allows a routine contained edit without a prompt', async () => {
    let prompts = 0;
    const approve = async () => { prompts += 1; return true; };
    const outcome = await authorizeResolvedTaskAction(request({
      tool: 'Edit',
      target: 'packages/cli/src/index.ts',
      lease: createTaskExecutionLease('do the work', true, WS),
      config: cfg({ agonPermissionMode: 'auto-edit' }),
    }) as never, approve as never);
    expect(outcome.decision).toBe('allow');
    expect(prompts).toBe(0);
  });
});

describe('resolvePermissionDecision — mode × action-class decision table', () => {
  // The lease's autoMode mirrors how brain.kern builds it: true exactly when
  // the effective permission mode is auto (or a one-shot /auto is queued).
  const decide = (mode: 'ask' | 'auto-edit' | 'auto', tool: string, target: string, prompt = 'do the work', extra: Record<string, unknown> = {}) =>
    resolvePermissionDecision(request({
      tool,
      target,
      lease: createTaskExecutionLease(prompt, mode === 'auto', WS),
      config: cfg({ agonPermissionMode: mode, ...extra }),
    }));

  // The turn text that used to trip `important_task` in every mode.
  const IMPORTANT = 'change the auth session permission migration for the database';

  const table: Array<[label: string, tool: string, target: string, prompt: string, ask: string, autoEdit: string, auto: string]> = [
    ['read-only tool', 'Read', 'src/index.ts', 'do the work', 'allow', 'allow', 'allow'],
    ['read-only command', 'Bash', 'git status', 'do the work', 'allow', 'allow', 'allow'],
    ['contained file edit', 'Edit', 'src/index.ts', 'do the work', 'ask', 'allow', 'allow'],
    ['contained file edit, important prompt text', 'Edit', 'src/index.ts', IMPORTANT, 'ask', 'allow', 'allow'],
    ['sensitive file edit (.env)', 'Write', '.env', 'do the work', 'ask', 'ask', 'allow'],
    ['sensitive file edit (git hook)', 'Edit', '.git/hooks/pre-commit', 'do the work', 'ask', 'ask', 'allow'],
    ['sensitive file edit (.husky)', 'Edit', '.husky/pre-commit', 'do the work', 'ask', 'ask', 'allow'],
    ['escaping file edit', 'Edit', '/etc/passwd', 'do the work', 'deny', 'deny', 'ask'],
    ['routine Bash mutation', 'Bash', 'npm run build', 'do the work', 'ask', 'ask', 'allow'],
    ['routine Bash mutation, important prompt text', 'Bash', 'npm run build', IMPORTANT, 'ask', 'ask', 'allow'],
    ['plain push', 'Bash', 'git push origin main', 'do the work', 'ask', 'ask', 'allow'],
    ['publish', 'Bash', 'npm publish', 'do the work', 'ask', 'ask', 'allow'],
    ['mutating curl', 'Bash', 'curl -X POST https://example.com/deploy', 'do the work', 'ask', 'ask', 'allow'],
    ['force push', 'Bash', 'git push --force origin main', 'do the work', 'ask', 'ask', 'ask'],
    ['remote branch deletion', 'Bash', 'git push origin :main', 'do the work', 'ask', 'ask', 'ask'],
    ['drop database', 'Bash', 'dropdb agon_dev', 'do the work', 'ask', 'ask', 'ask'],
    ['rm -rf', 'Bash', 'rm -rf build', 'do the work', 'ask', 'ask', 'ask'],
    ['shell write outside the workspace', 'Bash', 'printf boom > /etc/hosts', 'do the work', 'ask', 'ask', 'ask'],
  ];

  for (const [label, tool, target, prompt, ask, autoEdit, auto] of table) {
    it(`${label}: ask=${ask} auto-edit=${autoEdit} auto=${auto}`, () => {
      expect(decide('ask', tool, target, prompt).decision).toBe(ask);
      expect(decide('auto-edit', tool, target, prompt).decision).toBe(autoEdit);
      expect(decide('auto', tool, target, prompt).decision).toBe(auto);
    });
  }

  it('labels the carve-outs with their own reasons', () => {
    expect(decide('auto-edit', 'Edit', '.git/hooks/pre-commit')).toMatchObject({ decision: 'ask', reason: 'sensitive_path' });
    expect(decide('auto', 'Bash', 'git push --force origin main')).toMatchObject({ decision: 'ask', reason: 'destructive_boundary' });
    expect(decide('auto', 'Edit', '/etc/passwd')).toMatchObject({ decision: 'ask', reason: 'workspace_escape' });
    expect(decide('auto', 'Bash', 'git push origin main')).toMatchObject({ decision: 'allow', reason: 'routine_auto' });
  });

  it('a deny rule still wins in auto mode', () => {
    expect(decide('auto', 'Bash', 'rm -rf build', 'do the work', { permissions: { deny: ['Bash(rm:*)'] } }))
      .toMatchObject({ decision: 'deny', stage: 'deny-rule' });
    expect(decide('auto', 'Edit', 'src/index.ts', 'do the work', { permissions: { deny: ['Edit'] } }))
      .toMatchObject({ decision: 'deny', stage: 'deny-rule' });
    expect(decide('auto', 'Bash', 'npm run build', 'do the work', { permissionMode: 'deny-all' }))
      .toMatchObject({ decision: 'deny', stage: 'hard-deny' });
  });

  it('a sensitive-path ask is overridable by an explicit user rule', () => {
    expect(decide('auto-edit', 'Write', '.env', 'do the work', { permissions: { allow: [`Write(${WS}/.env)`] } }))
      .toMatchObject({ decision: 'allow', stage: 'allow-rule' });
  });

  it('the one-shot /auto lease override does not unlock sensitive files in auto-edit', () => {
    // lease.autoMode=true with mode auto-edit is exactly the `/auto <task>` shape.
    const oneShot = resolvePermissionDecision(request({
      tool: 'Edit',
      target: '.git/hooks/pre-commit',
      lease: createTaskExecutionLease('do the work', true, WS),
      config: cfg({ agonPermissionMode: 'auto-edit' }),
    }));
    expect(oneShot).toMatchObject({ decision: 'ask', reason: 'sensitive_path' });
  });
});

describe('workspace containment helper', () => {
  it('with an empty cwd only relative, non-escaping paths pass', () => {
    expect(fileTargetInsideWorkspace('', 'src/file.ts')).toBe(true);
    expect(fileTargetInsideWorkspace('', '/anywhere/file.ts')).toBe(false);
    expect(fileTargetInsideWorkspace('', '../escape.ts')).toBe(false);
    expect(fileTargetInsideWorkspace('', '~/notes.md')).toBe(false);
  });
  it('fails closed on empty targets and escapes', () => {
    expect(fileTargetInsideWorkspace(WS, '')).toBe(false);
    expect(fileTargetInsideWorkspace(WS, '../outside.ts')).toBe(false);
    expect(fileTargetInsideWorkspace(WS, 'src/inside.ts')).toBe(true);
  });
});

describe('rule synthesis', () => {
  it('synthesizes two-token Bash rules', () => {
    expect(synthesizePermissionRule('Bash', 'git push origin main', WS)).toBe('Bash(git push:*)');
    expect(synthesizePermissionRule('Bash', 'npm run build', WS)).toBe('Bash(npm run:*)');
  });
  it('skips key=value option tokens when picking the subcommand', () => {
    expect(synthesizePermissionRule('Bash', 'git -c user.name=Agon push origin', WS)).toBe('Bash(git push:*)');
  });
  it('refuses bare verbs, flags-only, compounds, and substitution', () => {
    expect(synthesizePermissionRule('Bash', 'ls', WS)).toBeNull();
    expect(synthesizePermissionRule('Bash', 'ls -la', WS)).toBeNull();
    expect(synthesizePermissionRule('Bash', 'npm test && rm -rf /', WS)).toBeNull();
    expect(synthesizePermissionRule('Bash', 'git commit $(cat x)', WS)).toBeNull();
    expect(synthesizePermissionRule('Bash', 'rm *', WS)).toBeNull();
  });
  it('synthesizes exact file rules and refuses rendered previews', () => {
    expect(synthesizePermissionRule('Edit', `${WS}/src/index.ts`, WS)).toBe(`Edit(${WS}/src/index.ts)`);
    expect(synthesizePermissionRule('Edit', 'src/index.ts (+3 -1)', WS)).toBeNull();
  });
  it('validates rules against the originating action', () => {
    expect(validateSynthesizedRule('Bash(git push:*)', 'Bash', 'git push origin main', WS)).toBe(true);
    expect(validateSynthesizedRule('Bash(git)', 'Bash', 'git push origin main', WS)).toBe(false);
    expect(validateSynthesizedRule('Bash(*)', 'Bash', 'git push origin main', WS)).toBe(false);
    expect(validateSynthesizedRule('Bash(npm test:*)', 'Bash', 'git push', WS)).toBe(false);
  });
});

describe('persistPermissionRule', () => {
  it('appends to the requested bucket and dedupes', () => {
    loadConfigMock.mockReturnValue({ permissions: { allow: [], deny: [] } });
    expect(persistPermissionRule('allow', 'Bash(git push:*)')).toBe(true);
    expect(configSetMock).toHaveBeenCalledWith('permissions', { allow: ['Bash(git push:*)'], deny: [] });
    loadConfigMock.mockReturnValue({ permissions: { allow: ['Bash(git push:*)'], deny: [] } });
    expect(persistPermissionRule('allow', 'Bash(git push:*)')).toBe(false);
  });
  it('removes the rule from the opposite bucket so Always after Never actually wins', () => {
    loadConfigMock.mockReturnValue({ permissions: { allow: [], deny: ['Bash(git push:*)'] } });
    expect(persistPermissionRule('allow', 'Bash(git push:*)')).toBe(true);
    expect(configSetMock).toHaveBeenCalledWith('permissions', { allow: ['Bash(git push:*)'], deny: [] });
    loadConfigMock.mockReturnValue({ permissions: { allow: ['Bash(npm test:*)'], deny: [] } });
    expect(persistPermissionRule('deny', 'Bash(npm test:*)')).toBe(true);
    expect(configSetMock).toHaveBeenCalledWith('permissions', { allow: [], deny: ['Bash(npm test:*)'] });
  });
});

describe('buildEffectivePermissionRuleSet', () => {
  it('merges persisted and session allow rules; deny stays persisted-only', () => {
    addSessionPermissionRule('Bash(cargo fmt:*)');
    const rules = buildEffectivePermissionRuleSet(cfg({ permissions: { allow: ['Edit'], deny: ['Bash(rm:*)'] } }));
    expect(rules.allow.length).toBe(2);
    expect(rules.deny.length).toBe(1);
  });
});

describe('authorizeResolvedTaskAction', () => {
  it('allows via rule without prompting', async () => {
    const prompt = vi.fn();
    const outcome = await authorizeResolvedTaskAction(
      request({ target: 'git push origin main', config: cfg({ permissions: { allow: ['Bash(git push:*)'] } }) }) as never,
      prompt as never,
    );
    expect(outcome.decision).toBe('allow');
    expect(prompt).not.toHaveBeenCalled();
  });
  it('denies via deny rule without prompting', async () => {
    const prompt = vi.fn();
    const outcome = await authorizeResolvedTaskAction(
      request({ target: 'rm -rf node_modules', config: cfg({ permissions: { deny: ['Bash(rm:*)'] } }) }) as never,
      prompt as never,
    );
    expect(outcome.decision).toBe('deny');
    expect(prompt).not.toHaveBeenCalled();
  });
  it('routes ask through the lease join machinery and records the approval', async () => {
    const lease = createTaskExecutionLease('build it', true, WS);
    const prompt = vi.fn(async () => true);
    const first = await authorizeResolvedTaskAction(
      request({ target: 'git push --force origin feature', lease }) as never,
      prompt as never,
    );
    expect(first.decision).toBe('allow');
    expect(prompt).toHaveBeenCalledTimes(1);
    const second = await authorizeResolvedTaskAction(
      request({ target: 'git push --force origin feature', lease }) as never,
      prompt as never,
    );
    expect(second.decision).toBe('allow');
    expect(prompt).toHaveBeenCalledTimes(1);
  });
  it('prompts once directly when no lease exists', async () => {
    const prompt = vi.fn(async () => false);
    const outcome = await authorizeResolvedTaskAction(
      request({ target: 'npm run build', config: cfg({ agonPermissionMode: 'ask' }) }) as never,
      prompt as never,
    );
    expect(outcome.decision).toBe('deny');
    expect(prompt).toHaveBeenCalledTimes(1);
  });
});

// ── Dogfood: gaps a live `agon mutate` run found in THIS suite ──────────────
// Every case below kills a mutant that survived the mutation run on
// packages/cli/src/generated/cesar/permission-resolver.ts — wrong code these
// tests used to call green. The run went 67% → 93%.
//
// The three mutants that still survive are EQUIVALENT BY CONSTRUCTION — no
// assertion can kill them, and adding one would only pretend otherwise:
//   • `if (!candidate) return false` in sensitivePathCandidateMatches: the
//     function is module-private and both of its call sites already guard the
//     argument non-empty, so the branch is unreachable.
//   • `!canonical || canonical === raw` → `&&`: both changed paths fall through
//     to sensitivePathCandidateMatches(canonical), which for canonical === raw
//     re-runs a pure function that just returned false, and for canonical === ''
//     hits the (unreachable-in-practice) empty guard above. Same answer either
//     way — the two mutants are only observable TOGETHER.
//   • `catch { return true }` in isLeaselessBashBoundary: the catch fires only
//     if DEFAULT_DANGEROUS_PATTERN stops being a valid regex, which no input
//     can cause.

describe('addSessionPermissionRule — the rule is VALIDATED before it is stored', () => {
  it('refuses a malformed rule, returns false, and stores nothing', () => {
    for (const bad of ['not a rule at all!!', '???', 'Bash(', 'a b c', '!!!']) {
      expect(addSessionPermissionRule(bad), bad).toBe(false);
    }
    expect(getSessionPermissionRules()).toEqual([]);
  });

  it('refuses empty, whitespace-only and non-string input', () => {
    expect(addSessionPermissionRule('')).toBe(false);
    expect(addSessionPermissionRule('   ')).toBe(false);
    expect(addSessionPermissionRule(undefined as never)).toBe(false);
    expect(addSessionPermissionRule(null as never)).toBe(false);
    expect(getSessionPermissionRules()).toEqual([]);
  });

  it('accepts a well-formed rule, returns true, and stores it exactly once', () => {
    expect(addSessionPermissionRule('Bash(cargo fmt:*)')).toBe(true);
    expect(addSessionPermissionRule('  Bash(cargo fmt:*)  ')).toBe(true);   // trimmed → the same rule
    expect(getSessionPermissionRules()).toEqual(['Bash(cargo fmt:*)']);
  });

  it('a refused rule never reaches the effective rule set', () => {
    addSessionPermissionRule('rm -rf /');
    expect(buildEffectivePermissionRuleSet(cfg()).allow).toEqual([]);
  });

  // The session store is a module-level array: handing out the live reference
  // would let any caller widen the session by pushing to it.
  it('getSessionPermissionRules returns a COPY, not the live store', () => {
    addSessionPermissionRule('Bash(cargo fmt:*)');
    const rules = getSessionPermissionRules();
    rules.push('Bash(rm:*)');
    rules[0] = 'tampered';
    expect(getSessionPermissionRules()).toEqual(['Bash(cargo fmt:*)']);
  });
});

describe('describeAgonPermissionMode — each mode gets its OWN label and hint', () => {
  it('names every mode exactly', () => {
    expect(describeAgonPermissionMode('auto').label).toBe('AUTO');
    expect(describeAgonPermissionMode('auto-edit').label).toBe('auto-edit');
    expect(describeAgonPermissionMode('ask').label).toBe('ask');
  });

  it('each hint names what that mode actually still prompts for', () => {
    // The AUTO hint is the one place the destructive carve-out is spelled out;
    // it is a contract with the user, not decoration.
    const auto = describeAgonPermissionMode('auto').hint;
    expect(auto).toContain('force push');
    expect(auto).toContain('rm -rf');
    expect(auto).toContain('drop database');

    const autoEdit = describeAgonPermissionMode('auto-edit').hint;
    expect(autoEdit).toContain('.env');
    expect(autoEdit).toContain('git hooks');

    expect(describeAgonPermissionMode('ask').hint).toContain('prompts before file edits');
    // No two modes describe themselves the same way.
    const hints = (['ask', 'auto-edit', 'auto'] as const).map((m) => describeAgonPermissionMode(m).hint);
    expect(new Set(hints).size).toBe(3);
  });
});

describe('buildEffectivePermissionRuleSet — a non-object `permissions` is {}', () => {
  it('never throws and never invents rules for a malformed persisted value', () => {
    for (const permissions of [null, 'nope', 42, true, ['Edit'], undefined]) {
      const build = () => buildEffectivePermissionRuleSet(cfg({ permissions }));
      expect(build, JSON.stringify(permissions ?? null)).not.toThrow();
      const rules = build();
      expect(rules.allow, JSON.stringify(permissions ?? null)).toEqual([]);
      expect(rules.deny, JSON.stringify(permissions ?? null)).toEqual([]);
    }
  });

  it('a malformed persisted value still lets a session rule through', () => {
    addSessionPermissionRule('Bash(cargo fmt:*)');
    const rules = buildEffectivePermissionRuleSet(cfg({ permissions: null }));
    expect(rules.allow).toHaveLength(1);
    expect(rules.deny).toEqual([]);
  });
});

describe('the sensitive-path matcher — how the basename is actually extracted', () => {
  it('an empty or all-separator path is never sensitive', () => {
    expect(isSensitivePermissionPath('')).toBe(false);
    expect(isSensitivePermissionPath('   ')).toBe(false);
    // No basename at all — the answer must be "not sensitive", never "sensitive".
    expect(isSensitivePermissionPath('/')).toBe(false);
    expect(isSensitivePermissionPath('//')).toBe(false);
  });

  it('matches on the BASENAME, not on any segment of the path', () => {
    expect(isSensitivePermissionPath(`${WS}/a/b/.env`)).toBe(true);
    expect(isSensitivePermissionPath(`${WS}/a/b/.env.local`)).toBe(true);
    // `env` is not `.env`, and a directory named .env does not make its
    // children sensitive.
    expect(isSensitivePermissionPath(`${WS}/a/b/env`)).toBe(false);
    expect(isSensitivePermissionPath(`${WS}/a/.env/notes.md`)).toBe(false);
    // …but an executable-on-checkout DIRECTORY is matched as a directory.
    expect(isSensitivePermissionPath(`${WS}/.git/hooks/pre-commit`)).toBe(true);
    expect(isSensitivePermissionPath(`${WS}/x/.husky/pre-push`)).toBe(true);
  });

  // The RAW spelling is matched on its own so canonicalization can only ADD
  // coverage. These paths canonicalize to something innocuous, so ONLY the raw
  // basename extraction can catch them — including its trailing-separator
  // normalization, which a `.env/` spelling depends on entirely.
  it('catches a sensitive RAW name whose canonical form is innocuous — with and without a trailing separator', () => {
    const dir = mkdtempSync(join(tmpdir(), 'agon-perm-basename-'));
    writeFileSync(join(dir, 'plain.txt'), 'x');
    symlinkSync(join(dir, 'plain.txt'), join(dir, '.env'));

    // Sanity: canonically this really is plain.txt, nothing sensitive.
    expect(isSensitivePermissionPath(join(dir, 'plain.txt'))).toBe(false);

    expect(isSensitivePermissionPath(join(dir, '.env'))).toBe(true);
    expect(isSensitivePermissionPath(`${join(dir, '.env')}/`)).toBe(true);
    expect(isSensitivePermissionPath(`${join(dir, '.env')}///`)).toBe(true);
    // Relative, with the workspace as cwd — no separator in the raw spelling.
    expect(isSensitivePermissionPath('.env', undefined, dir)).toBe(true);
    expect(isSensitivePermissionPath('.env/', undefined, dir)).toBe(true);

    rmSync(dir, { recursive: true, force: true });
  });
});

describe('the sensitive-path matcher — canonicalization with no cwd argument', () => {
  // The default cwd must be reachable: with `cwd` omitted the matcher falls
  // back to process.cwd(), and the RAW spelling below matches nothing — only
  // the canonical form does.
  it('canonicalizes against process.cwd() when no cwd is passed', () => {
    // Raw: `.git/x/../hooks` — the hook-directory pattern needs `.git/hooks`
    // adjacent, so the raw spelling evades it. Canonically it IS a git hook.
    expect(isSensitivePermissionPath('.git/x/../hooks/pre-commit')).toBe(true);
    expect(isSensitivePermissionPath('src/index.ts')).toBe(false);
  });
});

describe('resolvePermissionDecision — a malformed config never crashes the gate', () => {
  it('treats a non-object toolPermissions as {} instead of throwing', () => {
    for (const toolPermissions of [null, 'nope', 42, true, undefined]) {
      const call = () => resolvePermissionDecision(request({ config: cfg({ toolPermissions }) }));
      expect(call, JSON.stringify(toolPermissions ?? null)).not.toThrow();
      // …and the decision still comes from the mode, not from a phantom entry.
      expect(call().stage, JSON.stringify(toolPermissions ?? null)).toBe('mode');
    }
  });

  it('a malformed config still honours the deny stages that come before it', () => {
    const denied = resolvePermissionDecision(request({
      config: cfg({ toolPermissions: null, permissionMode: 'deny-all' }),
    }));
    expect(denied.decision).toBe('deny');
    expect(denied.stage).toBe('hard-deny');
  });
});
