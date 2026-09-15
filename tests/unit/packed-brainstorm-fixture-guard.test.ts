import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const guard = resolve('scripts/spec/fixtures/guard-brainstorm-effects.mjs');
const fixture = resolve('scripts/spec/fixtures/brainstorm-engine.mjs');

describe('packed Brainstorm diagnostic effect guard', () => {
  it.each([
    'spawn(process.execPath, ["-e", "console.log(123)"])',
    `spawn(process.execPath, [${JSON.stringify(fixture)}], { shell: true })`,
    'exec("echo should-not-run")',
    'fetch("https://example.invalid")',
    'fetch("data:text/javascript,console.log(123)")',
  ])('refuses an effect outside the fixture allowlist: %s', expression => {
    const result = spawnSync(process.execPath, ['--import', guard, '--input-type=module', '-e',
      `import { spawn, exec } from 'node:child_process'; ${expression};`], {
      encoding: 'utf8', timeout: 5000, env: {},
    });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('PACKED_BRAINSTORM_EFFECT_BLOCKED');
    expect(result.stdout).toBe('');
  });

  it('allows bounded inline WASM bytes without a network request', () => {
    const result = spawnSync(process.execPath, ['--import', guard, '--input-type=module', '-e',
      'const response = await fetch("data:application/octet-stream;base64,AGFzbQEAAAA="); console.log(Buffer.from(await response.arrayBuffer()).toString("hex"));'], {
      encoding: 'utf8', timeout: 5000, env: {},
    });
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('0061736d01000000');
  });

  it('allows the exact fixture through real Node dispatch', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'agon-brainstorm-guard-'));
    try {
      const gate = join(scratch, 'gate');
      const log = join(scratch, 'calls');
      writeFileSync(gate, 'ready');
      const args = [fixture, gate, log, 'human', 'Installed fixture question\n## Response Format'];
      const result = spawnSync(process.execPath, ['--import', guard, '--input-type=module', '-e',
        `import { spawn } from 'node:child_process';
         const child = spawn(process.execPath, ${JSON.stringify(args)}, { stdio: 'inherit' });
         child.on('close', code => { process.exitCode = code ?? 1; });`], {
        encoding: 'utf8', timeout: 5000, env: {},
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('draft {');
      expect(readFileSync(log, 'utf8')).toBe('draft\n');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});
