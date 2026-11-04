import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CLASSIFIER_DISABLE_ENV,
  CLASSIFIER_MAX_INPUT_CHARS,
  classifyTask,
  classifyTaskSemantic,
  resetClassifierSidecarState,
} from '@kernlang/agon-support-dedup';

let root: string;
let calls: string;

const spawnCount = () => readFileSync(calls, 'utf8').split('\n').filter(Boolean).length;

function installSidecar(body: string) {
  const executable = join(root, 'fixture-classifier');
  writeFileSync(executable, `#!${process.execPath}
const fs = require('node:fs');
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
fs.appendFileSync(${JSON.stringify(calls)}, JSON.stringify(input) + '\\n');
${body}
`);
  chmodSync(executable, 0o700);
  vi.stubEnv('AGON_PYTHON', executable);
}

const SUCCESS = `process.stdout.write(JSON.stringify({ class: 'feature' }));`;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'agon-classifier-sidecar-'));
  calls = join(root, 'calls.ndjson');
  writeFileSync(calls, '');
  vi.stubEnv('AGON_HOME', root);
  vi.stubEnv(CLASSIFIER_DISABLE_ENV, '');
  resetClassifierSidecarState();
});

afterEach(() => {
  resetClassifierSidecarState();
  vi.unstubAllEnvs();
  rmSync(root, { recursive: true, force: true });
});

describe('AC-1 sidecar failure is terminal per process', () => {
  it('exit 1 spawns once across three distinct descriptions', () => {
    installSidecar('process.exit(1);');
    for (const text of ['alpha one', 'beta two', 'gamma three']) expect(classifyTaskSemantic(text)).toBeNull();
    expect(spawnCount()).toBe(1);
  });

  it('the same description after failure does not respawn', () => {
    installSidecar('process.exit(1);');
    for (let i = 0; i < 3; i++) expect(classifyTaskSemantic('alpha one')).toBeNull();
    expect(spawnCount()).toBe(1);
  });

  it('empty stdout with exit 0 latches', () => {
    installSidecar('');
    expect(classifyTaskSemantic('alpha one')).toBeNull();
    expect(classifyTaskSemantic('beta two')).toBeNull();
    expect(spawnCount()).toBe(1);
  });

  it('a missing interpreter latches without any spawn record', () => {
    installSidecar(SUCCESS);
    vi.stubEnv('AGON_PYTHON', join(root, 'missing'));
    expect(classifyTaskSemantic('alpha one')).toBeNull();
    vi.stubEnv('AGON_PYTHON', join(root, 'fixture-classifier'));
    expect(classifyTaskSemantic('beta two')).toBeNull();
    expect(spawnCount()).toBe(0);
  });

  it('a timeout latches after one blocking call', () => {
    installSidecar('setTimeout(() => {}, 10000);');
    const started = performance.now();
    expect(classifyTaskSemantic('alpha one')).toBeNull();
    expect(performance.now() - started).toBeGreaterThanOrEqual(1900);
    const second = performance.now();
    expect(classifyTaskSemantic('beta two')).toBeNull();
    expect(performance.now() - second).toBeLessThan(500);
    expect(spawnCount()).toBe(1);
  });

  it('reset clears the latch so the next success spawns exactly once more', () => {
    installSidecar('process.exit(1);');
    expect(classifyTaskSemantic('alpha one')).toBeNull();
    installSidecar(SUCCESS);
    expect(classifyTaskSemantic('beta two')).toBeNull();
    expect(spawnCount()).toBe(1);
    resetClassifierSidecarState();
    expect(classifyTaskSemantic('beta two')).toBe('feature');
    expect(spawnCount()).toBe(2);
  });

  it('the disable env set after import prevents every spawn', () => {
    installSidecar(SUCCESS);
    vi.stubEnv(CLASSIFIER_DISABLE_ENV, '1');
    expect(classifyTaskSemantic('alpha one')).toBeNull();
    expect(classifyTask('alpha one')).toBe('other');
    expect(spawnCount()).toBe(0);
  });
});

describe('AC-2 success is cached per description', () => {
  it('serves a repeat from cache and spawns for a new description', () => {
    installSidecar(SUCCESS);
    expect(classifyTaskSemantic('alpha one')).toBe('feature');
    expect(classifyTaskSemantic('alpha one')).toBe('feature');
    expect(spawnCount()).toBe(1);
    expect(classifyTaskSemantic('beta two')).toBe('feature');
    expect(spawnCount()).toBe(2);
  });

  it.each([
    ['malformed JSON', `process.stdout.write('{');`],
    ['an invalid class', `process.stdout.write(JSON.stringify({ class: 'nonsense' }));`],
  ])('caches null for %s per description only', (_label, body) => {
    installSidecar(body);
    expect(classifyTaskSemantic('alpha one')).toBeNull();
    expect(classifyTaskSemantic('alpha one')).toBeNull();
    expect(spawnCount()).toBe(1);
    expect(classifyTaskSemantic('beta two')).toBeNull();
    expect(spawnCount()).toBe(2);
  });
});

describe('sidecar input is bounded', () => {
  const sentText = () => JSON.parse(readFileSync(calls, 'utf8').split('\n')[0]).text as string;

  it('skips a blank description without spawning or latching', () => {
    installSidecar(SUCCESS);
    expect(classifyTaskSemantic('   ')).toBeNull();
    expect(spawnCount()).toBe(0);
    expect(classifyTaskSemantic('alpha one')).toBe('feature');
  });

  it('sends at most the cap for an oversized paste', () => {
    installSidecar(SUCCESS);
    expect(classifyTaskSemantic('x'.repeat(CLASSIFIER_MAX_INPUT_CHARS * 3))).toBe('feature');
    expect(sentText()).toHaveLength(CLASSIFIER_MAX_INPUT_CHARS);
  });

  it('never splits a surrogate pair at the cap', () => {
    installSidecar(SUCCESS);
    const text = 'x'.repeat(CLASSIFIER_MAX_INPUT_CHARS - 1) + '😀' + 'tail';
    expect(classifyTaskSemantic(text)).toBe('feature');
    expect(sentText()).toBe('x'.repeat(CLASSIFIER_MAX_INPUT_CHARS - 1));
  });
});

describe('AC-3 classifyTask blocks at most once with the sidecar enabled', () => {
  it('five other-class prompts against a stalling sidecar spawn once', () => {
    installSidecar('setTimeout(() => {}, 10000);');
    const started = performance.now();
    for (const text of ['alpha one', 'beta two', 'gamma three', 'delta four', 'epsilon five']) {
      expect(classifyTask(text)).toBe('other');
    }
    expect(performance.now() - started).toBeLessThan(4000);
    expect(spawnCount()).toBe(1);
  });
});
