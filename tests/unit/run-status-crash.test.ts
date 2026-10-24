import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';
import { expect, it } from 'vitest';

const phases = ['during-stage-write', 'before-file-sync', 'after-file-sync', 'after-stage-directory-sync', 'before-publish', 'after-publish', 'after-final-directory-sync'] as const;

it.each(phases)('preserves a whole old or new result when killed at %s', phase => {
  const dir = mkdtempSync(join(tmpdir(), 'agon-status-crash-'));
  try {
    for (const name of ['run-dir', 'paths']) {
      const source = readFileSync(resolve(`packages/support-persistence/src/${name}.ts`), 'utf8').replace('./paths.js', './paths.mjs');
      writeFileSync(join(dir, `${name}.mjs`), ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText);
    }
    const old = '{"ok":false,"summary":"previous result"}\n';
    const outcome = { ok: true, summary: 'new actual result' };
    writeFileSync(join(dir, 'status.json'), old);
    const program = `
      import fs from 'node:fs';
      import {syncBuiltinESMExports} from 'node:module';
      const phase = ${JSON.stringify(phase)};
      const stop = name => {
        if (name !== phase) return;
        fs.writeFileSync(${JSON.stringify(join(dir, 'boundary'))}, name);
        process.kill(process.pid, 'SIGKILL');
      };
      const sync = fs.fsyncSync, rename = fs.renameSync;
      const write = fs.writeFileSync;
      fs.writeFileSync = (target, data, ...args) => {
        if (phase === 'during-stage-write' && typeof target === 'number') {
          write(target, String(data).slice(0, 5), ...args);
          stop('during-stage-write');
        }
        return write(target, data, ...args);
      };
      let directories = 0;
      fs.fsyncSync = fd => {
        const directory = fs.fstatSync(fd).isDirectory();
        if (!directory) stop('before-file-sync');
        sync(fd);
        if (!directory) stop('after-file-sync');
        else stop(++directories === 1 ? 'after-stage-directory-sync' : 'after-final-directory-sync');
      };
      fs.renameSync = (...args) => { stop('before-publish'); rename(...args); stop('after-publish'); };
      syncBuiltinESMExports();
      const {writeRunStatus} = await import(${JSON.stringify(pathToFileURL(join(dir, 'run-dir.mjs')).href)});
      writeRunStatus(${JSON.stringify(dir)}, ${JSON.stringify(outcome)});
    `;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', program], {
      env: { PATH: process.env.PATH, HOME: dir, AGON_HOME: dir }, encoding: 'utf8', timeout: 5000,
    });
    expect(child.error).toBeUndefined();
    expect(child.signal).toBe('SIGKILL');
    expect(readFileSync(join(dir, 'boundary'), 'utf8')).toBe(phase);
    const published = phase === 'after-publish' || phase === 'after-final-directory-sync';
    const final = readFileSync(join(dir, 'status.json'), 'utf8');
    if (published) expect(JSON.parse(final)).toEqual(outcome);
    else {
      expect(final).toBe(old);
      const candidate = readFileSync(join(dir, '.status.json.tmp'), 'utf8');
      if (phase === 'during-stage-write') expect(() => JSON.parse(candidate)).toThrow();
      else expect(JSON.parse(candidate)).toEqual(outcome);
    }
    expect(existsSync(join(dir, '.status.json.tmp'))).toBe(!published);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
