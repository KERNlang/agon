import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { spawnStream, spawnWithTimeout } from '../../packages/support-engine-runtime/src/process.js';

it.each([false, true])('shares and removes the exit handler across concurrent runs (streaming=%s)', async streaming => {
  const before = process.listenerCount('exit');
  const runs = Array.from({ length: 12 }, () => {
    const opts = { command: process.execPath, args: ['-e', 'setTimeout(() => {}, 50)'], cwd: process.cwd(), timeout: 5000 };
    return streaming ? (async () => { for await (const _chunk of spawnStream(opts)) { /* drain */ } })() : spawnWithTimeout(opts);
  });
  expect(process.listenerCount('exit')).toBe(before + 1);
  await Promise.all(runs);
  expect(process.listenerCount('exit')).toBe(before);
});

it.each([false, true])('does not orphan an owned engine when its host exits (streaming=%s)', async streaming => {
  const scratch = mkdtempSync(join(tmpdir(), 'agon-host-exit-'));
  const ready = join(scratch, 'ready');
  const module = join(scratch, 'process.mjs');
  const source = readFileSync(resolve('packages/support-engine-runtime/src/process.ts'), 'utf8');
  writeFileSync(module, ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText);
  const engine = `const fs = require('node:fs'); fs.writeFileSync(${JSON.stringify(ready + '.tmp')}, String(process.pid)); fs.renameSync(${JSON.stringify(ready + '.tmp')}, ${JSON.stringify(ready)}); setTimeout(() => process.exit(0), 10000);`;
  const host = `import {spawnWithTimeout,spawnStream} from ${JSON.stringify(pathToFileURL(module).href)};
    import {existsSync} from 'node:fs'; import {setTimeout as delay} from 'node:timers/promises';
    const opts={command:process.execPath,args:['-e',${JSON.stringify(engine)}],cwd:${JSON.stringify(scratch)},timeout:12000};
    ${streaming ? 'void spawnStream(opts).next();' : 'void spawnWithTimeout(opts);'}
    for(let i=0; !existsSync(${JSON.stringify(ready)}) && i<200; i++) await delay(10);
    process.exit(0);`;
  let pid: number | undefined;
  try {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', host], { encoding: 'utf8', timeout: 5000 });
    pid = Number(readFileSync(ready, 'utf8'));
    expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    await delay(200);
    expect(() => process.kill(pid!, 0)).toThrow(expect.objectContaining({ code: 'ESRCH' }));
  } finally {
    if (pid) { try { process.kill(-pid, 'SIGKILL'); } catch { /* already gone */ } }
    rmSync(scratch, { recursive: true, force: true });
  }
});
