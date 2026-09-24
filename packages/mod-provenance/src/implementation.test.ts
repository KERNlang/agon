import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModServices } from '@kernlang/agon-mod-api';
import { runProvenance } from './implementation.js';
const old = process.env.AGON_HOME;
afterEach(() => { if (old === undefined) delete process.env.AGON_HOME; else process.env.AGON_HOME = old; });
const context = {} as any;
function services(allow='allow') { return {receipts:{record:vi.fn(async()=> 'p')},permissions:{check:vi.fn(async()=>allow)}} as unknown as ModServices; }
describe('physical provenance mod', () => {
  it('builds a tamper-evident honest report and writes atomically with permission', async () => {
    const home = mkdtempSync(join(tmpdir(),'provenance-')); process.env.AGON_HOME = home; mkdirSync(join(home,'runs'));
    writeFileSync(join(home,'runs','run1.json'),JSON.stringify({forgeId:'run1',task:'task | injected\nheading',timestamp:'2026',engines:['a','b'],winner:'a',fitnessCmd:'npm test',results:{a:{score:9,pass:true},b:{score:4,pass:false}}}));
    const result = await runProvenance({format:'md'},context,services());
    expect(result.stdout).toContain('sha256:'); expect(result.stdout).toContain('task | injected heading');
    const out = join(home,'report.json'); expect((await runProvenance({format:'json',out},context,services())).exitCode).toBe(0);
    expect(JSON.parse(readFileSync(out,'utf8')).winner).toBe('a');
  });
  it('refuses invalid format, ambiguous prefixes, and denied writes', async () => {
    const home = mkdtempSync(join(tmpdir(),'provenance-')); process.env.AGON_HOME = home; mkdirSync(join(home,'runs'));
    for (const file of ['a1.json','a2.json']) writeFileSync(join(home,'runs',file),JSON.stringify({forgeId:file,task:'x'}));
    expect((await runProvenance({format:'xml'},context,services())).exitCode).toBe(1);
    expect((await runProvenance({id:'a'},context,services())).stderr).toContain('ambiguous');
    expect((await runProvenance({id:'a1',out:join(home,'x')},context,services('deny'))).exitCode).toBe(1);
  });
});
