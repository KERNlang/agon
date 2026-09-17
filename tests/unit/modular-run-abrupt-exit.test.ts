import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

function compileFixtureModule(sourcePath: string, targetPath: string): void {
  const source = readFileSync(resolve(sourcePath), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText.replace('@kernlang/agon-support-persistence', pathToFileURL(resolve('packages/support-persistence/dist/index.js')).href);
  writeFileSync(targetPath, compiled);
}

it.each(['SIGKILL', 'SIGTERM'] as const)('does not mistake an unfinished run for success or infer ownership after %s', async signal => {
  const scratch = mkdtempSync(join(tmpdir(), 'agon-abrupt-run-'));
  const modulePath = join(scratch, 'host.mjs');
  const readerPath = join(scratch, 'history.mjs');
  compileFixtureModule('packages/cli/src/run-record-host.ts', modulePath);
  compileFixtureModule('packages/mod-history/src/implementation.ts', readerPath);
  const env = { PATH: process.env.PATH, HOME: scratch, AGON_HOME: scratch };
  const program = `
    import {cliRunRecordHost as runs} from ${JSON.stringify(pathToFileURL(modulePath).href)};
    const handle = await runs.start('brainstorm', 'abrupt-fixture', {});
    await runs.writeArtifact(handle, 'partial.txt', 'retained partial draft', {});
    process.stdout.write(JSON.stringify(handle) + '\\n');
    setTimeout(() => process.exit(2), 10000);
  `;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  try {
    let output = '';
    for await (const chunk of child.stdout) {
      output += chunk.toString();
      if (output.includes('\n')) break;
    }
    const handle = JSON.parse(output);
    const owner = JSON.parse(readFileSync(join(handle.path, 'owner.json'), 'utf8'));
    if (process.env.AGON_TEST_REQUIRE_OWNER_PROBE === '1') expect(owner.bootId).not.toBeNull();
    const assertUnfinished = (afterDeath: boolean) => {
      const reader = spawnSync(process.execPath, ['--input-type=module', '-e', `
        import {runLast} from ${JSON.stringify(pathToFileURL(readerPath).href)};
        console.log(JSON.stringify(await runLast({status: true}, {}, {})));
      `], { env, encoding: 'utf8', timeout: 5000 });
      expect(reader.error).toBeUndefined();
      expect(reader.status).toBe(0);
      expect(reader.stderr).toBe('');
      const result = JSON.parse(reader.stdout);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBeUndefined();
      expect(result.stderr).toContain('may still be running or may have been interrupted');
      expect(result.stderr).toContain('inspect partial artifacts before retrying');
      expect(result.stderr).toContain('Owner observation:');
      if (process.env.AGON_TEST_REQUIRE_OWNER_PROBE === '1') {
        expect(result.stderr).toContain(afterDeath ? 'process-absent' : 'pid-present-ownership-unverified');
      }
      expect(existsSync(join(handle.path, 'status.json'))).toBe(false);
      expect(readFileSync(join(handle.path, 'partial.txt'), 'utf8')).toBe('retained partial draft');
    };
    // An unfinished record is not proof of a crash: the owner is alive here.
    expect(child.pid).toBeGreaterThan(0);
    expect(() => process.kill(child.pid!, 0)).not.toThrow();
    assertUnfinished(false);
    expect(child.kill(signal)).toBe(true);
    expect(await closed).toEqual([null, signal]);
    // A fresh reader must not fabricate a final outcome after abrupt death either.
    assertUnfinished(true);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
    rmSync(scratch, { recursive: true, force: true });
  }
}, 15000);
