import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  parsePermissionRule,
  parsePermissionRuleSet,
  ruleMatches,
  evaluatePermissionRules,
} from '../../packages/core/src/generated/tools/tool-permissions.js';
import { loadConfig } from '../../packages/core/src/generated/signals/config.js';
import { setupTestAgonHome, cleanupTestAgonHome } from '../helpers/agon-home.js';

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
