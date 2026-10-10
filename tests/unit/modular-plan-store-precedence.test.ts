import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCesarPlan } from '../../packages/mod-plan/src/execution-state.js';
import { cesarPlanJsonPath, cesarPlanMarkdownPath, loadCesarPlan, listCesarPlans, saveCesarPlan } from '../../packages/mod-plan/src/execution-store.js';

const fault = vi.hoisted(() => ({ path: '', code: '', directory: false }));
vi.mock('node:fs', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs')>();
  const fail = (path: unknown, directory: boolean) => {
    if (String(path) === fault.path && fault.code && directory === fault.directory) {
      throw Object.assign(new Error('fixture I/O fault'), { code: fault.code });
    }
  };
  return { ...fs,
    readFileSync: (...args: Parameters<typeof fs.readFileSync>) => { fail(args[0], false); return fs.readFileSync(...args); },
    readdirSync: (...args: Parameters<typeof fs.readdirSync>) => { fail(args[0], true); return fs.readdirSync(...args); },
  };
});

let root: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agon-plan-precedence-'));
  vi.stubEnv('AGON_HOME', root);
  mkdirSync(join(root, 'plans'));
  mkdirSync(join(root, 'runs'));
  fault.path = ''; fault.code = ''; fault.directory = false;
});
afterEach(() => {
  fault.code = '';
  vi.restoreAllMocks(); vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

function legacy() {
  const plan = { ...createCesarPlan('legacy fixture', []), id: 'cplan-fixture' };
  writeFileSync(join(root, 'runs', `${plan.id}.json`), JSON.stringify(plan));
  return plan;
}

it('keeps valid legacy records readable only when their canonical record is absent', () => {
  const plan = legacy();
  expect(loadCesarPlan(plan.id)).toEqual(plan);
  expect(listCesarPlans()).toEqual([plan]);
  const current = { ...plan, state: 'cancelled' as const };
  saveCesarPlan(current);
  expect(loadCesarPlan(plan.id)?.state).toBe('cancelled');
  expect(listCesarPlans().map(value => value.state)).toEqual(['cancelled']);
});

it.each(['cplan-fixture!', '../cplan-fixture', 'cplan-fixture.json', ' cplan-fixture'])('rejects ID alias %j without selecting or overwriting a record', id => {
  const plan = legacy();
  saveCesarPlan(plan);
  const path = cesarPlanJsonPath(plan.id);
  const before = readFileSync(path);
  expect(() => cesarPlanJsonPath(id)).toThrow(/Invalid plan ID/);
  expect(() => cesarPlanMarkdownPath(id)).toThrow(/Invalid plan ID/);
  expect(loadCesarPlan(id)).toBeNull();
  expect(() => saveCesarPlan({ ...plan, id })).toThrow(/Invalid plan ID/);
  expect(readFileSync(path)).toEqual(before);
});

it.each(['broken-json', 'wrong-id', 'null'] as const)('does not revive a legacy copy when its canonical record is %s', failure => {
  const plan = legacy();
  const path = cesarPlanJsonPath(plan.id);
  const bytes = failure === 'broken-json' ? '{broken' : failure === 'null' ? 'null' : JSON.stringify({ ...plan, id: 'cplan-other' });
  writeFileSync(path, bytes);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(loadCesarPlan(plan.id)).toBeNull();
  expect(listCesarPlans()).toEqual([]);
  expect(readFileSync(path, 'utf8')).toBe(bytes);
  expect(warn).toHaveBeenCalled();
});

it.each(['EACCES', 'EIO', 'ENOTDIR'])('refuses fallback on canonical I/O error %s', code => {
  const plan = legacy();
  fault.path = cesarPlanJsonPath(plan.id); fault.code = code;
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(loadCesarPlan(plan.id)).toBeNull();
  fault.path = join(root, 'plans'); fault.directory = true;
  expect(listCesarPlans()).toEqual([]);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining(code));
});

it.each(['file', 'directory'])('does not treat a dangling canonical %s symlink as absence', kind => {
  const plan = legacy();
  const legacyPath = join(root, 'runs', `${plan.id}.json`);
  const bytes = readFileSync(legacyPath);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  if (kind === 'directory') {
    rmSync(join(root, 'plans'), { recursive: true });
    symlinkSync(join(root, 'absent'), join(root, 'plans'));
  } else symlinkSync(join(root, 'absent'), cesarPlanJsonPath(plan.id));
  expect(loadCesarPlan(plan.id)).toBeNull();
  expect(listCesarPlans()).toEqual([]);
  expect(readFileSync(legacyPath)).toEqual(bytes);
});

it('bounds diagnostics for many corrupt records while retaining healthy records', () => {
  const plan = legacy();
  saveCesarPlan(plan);
  for (let i = 0; i < 100; i++) writeFileSync(join(root, 'plans', `cplan-bad-${i}.json`), '{broken');
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(listCesarPlans().map(value => value.id)).toEqual([plan.id]);
  expect(warn).toHaveBeenCalledOnce();
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('100'));
});

it('preserves valid directory symlinks and legacy fallback for genuinely missing records', () => {
  const plan = legacy();
  rmSync(join(root, 'plans'), { recursive: true });
  mkdirSync(join(root, 'linked-plans'));
  symlinkSync(join(root, 'linked-plans'), join(root, 'plans'));
  expect(loadCesarPlan(plan.id)).toEqual(plan);
  expect(listCesarPlans()).toEqual([plan]);
  saveCesarPlan({ ...plan, state: 'cancelled' });
  expect(loadCesarPlan(plan.id)?.state).toBe('cancelled');
  expect(listCesarPlans().map(value => value.state)).toEqual(['cancelled']);
});

it('suppresses an unreadable canonical file but keeps unrelated healthy records', () => {
  const plan = legacy();
  saveCesarPlan(plan);
  saveCesarPlan({ ...plan, id: 'cplan-healthy' });
  fault.path = cesarPlanJsonPath(plan.id); fault.code = 'EACCES';
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(listCesarPlans().map(value => value.id)).toEqual(['cplan-healthy']);
});

it.each([null, [], {}, { id: 'cplan-other' }])('refuses mismatched legacy identity %j', value => {
  const path = join(root, 'runs', 'cplan-fixture.json');
  const bytes = JSON.stringify(value);
  writeFileSync(path, bytes);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(loadCesarPlan('cplan-fixture')).toBeNull();
  expect(listCesarPlans()).toEqual([]);
  expect(readFileSync(path, 'utf8')).toBe(bytes);
});

it('reads raw canonical and enveloped legacy records without changing bytes', () => {
  const plan = legacy();
  saveCesarPlan(plan);
  const path = cesarPlanJsonPath(plan.id);
  const oldPath = join(root, 'runs', `${plan.id}.json`);
  const envelope = readFileSync(path);
  renameSync(path, oldPath);
  expect(loadCesarPlan(plan.id)?.id).toBe(plan.id);
  expect(listCesarPlans().map(value => value.id)).toEqual([plan.id]);
  expect(readFileSync(oldPath)).toEqual(envelope);
  const raw = JSON.stringify(plan);
  writeFileSync(path, raw);
  expect(loadCesarPlan(plan.id)?.id).toBe(plan.id);
  expect(listCesarPlans().map(value => value.id)).toEqual([plan.id]);
  expect(readFileSync(path, 'utf8')).toBe(raw);
  expect(readFileSync(oldPath)).toEqual(envelope);
});

it.each(['wrong-kind', 'invalid-utf8'])('preserves both copies and refuses canonical %s', failure => {
  const plan = legacy();
  const oldPath = join(root, 'runs', `${plan.id}.json`);
  const before = readFileSync(oldPath);
  saveCesarPlan(plan);
  const path = cesarPlanJsonPath(plan.id);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  value.kind = 'result';
  const bytes = failure === 'wrong-kind' ? Buffer.from(JSON.stringify(value)) : Buffer.from([255, 0, 123]);
  writeFileSync(path, bytes);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  expect(loadCesarPlan(plan.id)).toBeNull();
  expect(listCesarPlans()).toEqual([]);
  expect(readFileSync(path)).toEqual(bytes);
  expect(readFileSync(oldPath)).toEqual(before);
});
