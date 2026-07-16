import { beforeEach, describe, expect, it, vi } from 'vitest';

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
  it('lease workspace escape denies file mutations', () => {
    const lease = createTaskExecutionLease('fix the bug', true, WS);
    const r = resolvePermissionDecision(request({ tool: 'Edit', target: '/etc/passwd', lease }));
    expect(r).toMatchObject({ decision: 'deny', stage: 'lease', reason: 'workspace_escape' });
  });
});

describe('resolvePermissionDecision — allow sources', () => {
  it('an allow rule auto-approves and beats the lease dangerous boundary', () => {
    const lease = createTaskExecutionLease('build the feature', true, WS);
    const r = resolvePermissionDecision(request({
      target: 'git push origin feature',
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
  it('legacy bare tokens and tool-level allows never cover a dangerous boundary', () => {
    const lease = createTaskExecutionLease('build the feature', true, WS);
    const viaToken = resolvePermissionDecision(request({
      target: 'git push origin main',
      lease,
      config: cfg({ allowedCommands: ['git'] }),
    }));
    expect(viaToken).toMatchObject({ decision: 'ask', reason: 'dangerous_boundary' });
    const viaToolAllow = resolvePermissionDecision(request({
      target: 'git push origin main',
      lease,
      config: cfg({ toolPermissions: { Bash: 'allow' } }),
    }));
    expect(viaToolAllow).toMatchObject({ decision: 'ask', reason: 'dangerous_boundary' });
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
  it('a dangerous lease boundary asks even in auto mode', () => {
    const lease = createTaskExecutionLease('build the feature', true, WS);
    const r = resolvePermissionDecision(request({
      target: 'git push origin main',
      lease,
      config: cfg({ agonPermissionMode: 'auto' }),
    }));
    expect(r).toMatchObject({ decision: 'ask', stage: 'lease', reason: 'dangerous_boundary' });
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
      request({ target: 'git push origin feature', lease }) as never,
      prompt as never,
    );
    expect(first.decision).toBe('allow');
    expect(prompt).toHaveBeenCalledTimes(1);
    const second = await authorizeResolvedTaskAction(
      request({ target: 'git push origin feature', lease }) as never,
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
