import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ModServices } from '@kernlang/agon-mod-api';
import { buildProvenance, runProvenance } from './implementation.js';
const old = process.env.AGON_HOME;
afterEach(() => { if (old === undefined) delete process.env.AGON_HOME; else process.env.AGON_HOME = old; });
const context = {} as any;
function services(allow='allow') { return {receipts:{record:vi.fn(async()=> 'p')},permissions:{check:vi.fn(async()=>allow)}} as unknown as ModServices; }
describe('physical provenance mod', () => {
  it.each([
    { fitnessCmd: 42, reason: 'rejected', expectedGate: '42', expectedReason: 'rejected' },
    { fitnessCmd: 'npm test', reason: 42, expectedGate: 'npm test', expectedReason: '42' },
    { fitnessCmd: 'npm test', reason: true, expectedGate: 'npm test', expectedReason: 'true' },
  ])('renders historical manifest primitives: $fitnessCmd / $reason', async ({ fitnessCmd, reason, expectedGate, expectedReason }) => {
    const home = mkdtempSync(join(tmpdir(), 'provenance-primitives-'));
    process.env.AGON_HOME = home;
    mkdirSync(join(home, 'runs'));
    writeFileSync(join(home, 'runs', 'run.json'), JSON.stringify({
      forgeId: 'primitive-report', task: 'historical report', timestamp: '2026',
      fitnessCmd, engines: ['a', 'b'], winner: 'a',
      results: { a: { score: 9, pass: true }, b: { score: 4, pass: false, reason } },
    }));
    const result = await runProvenance({ format: 'md' }, context, services());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(`**Success criterion (defined by the human):** \`${expectedGate}\``);
    expect(result.stdout).toContain(`| b | rejected | no | not-accepted | 4 | ${expectedReason} |`);
  });

  it('still refuses a report when its strict source hash cannot be read', () => {
    const home = mkdtempSync(join(tmpdir(), 'provenance-missing-'));
    expect(() => buildProvenance({ forgeId: 'missing', task: 'x', timestamp: '2026' }, join(home, 'absent.json')))
      .toThrow(/ENOENT/);
  });

  it('omits unavailable contribution fields from the physical in-memory result', () => {
    const home = mkdtempSync(join(tmpdir(), 'provenance-shape-'));
    const manifest = { forgeId: 'shape', task: 'x', timestamp: '2026', results: { a: {} } };
    const path = join(home, 'manifest.json');
    writeFileSync(path, JSON.stringify(manifest));
    const result = buildProvenance(manifest, path);
    expect(Object.hasOwn(result.contributions[0]!, 'score')).toBe(false);
    expect(Object.hasOwn(result.contributions[0]!, 'costUsd')).toBe(false);
    expect(result.contributions[0]!.accepted).toBe(false);
  });

  it.each([false, true])('names the recorded winner when synthesis wins=%s', async (wins) => {
    const home = mkdtempSync(join(tmpdir(), 'provenance-winner-'));
    process.env.AGON_HOME = home;
    mkdirSync(join(home, 'runs'));
    writeFileSync(join(home, 'runs', 'run.json'), JSON.stringify({
      forgeId: 'winner-report', task: 'existing report contract', timestamp: '2026',
      engines: ['a', 'b'], winner: 'a', fitnessCmd: 'npm test',
      results: { a: { score: 9, pass: true }, b: { score: 4, pass: false } },
      synthesis: { wins, score: wins ? 10 : 8, pass: true, originalWinnerScore: 9 },
    }));
    const result = await runProvenance({ format: 'md' }, context, services());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('**Winner:** `a`');
  });

  it('discloses shared authorship when the accepted patch is a synthesis blend', async () => {
    const home = mkdtempSync(join(tmpdir(), 'provenance-blend-'));
    process.env.AGON_HOME = home;
    mkdirSync(join(home, 'runs'));
    writeFileSync(join(home, 'runs', 'run.json'), JSON.stringify({
      forgeId: 'blended-report', task: 'existing blend disclosure', timestamp: '2026',
      engines: ['a', 'b'], winner: 'a',
      results: { a: { score: 9, pass: true }, b: { score: 4, pass: false } },
      synthesis: { wins: true, score: 10, pass: true, originalWinnerScore: 9 },
    }));
    const result = await runProvenance({ format: 'md' }, context, services());
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('**Note:** the accepted patch is a *synthesis blend*');
    expect(result.stdout).toContain('authorship is shared across engines and cannot be attributed to one.');
  });

  it('builds a tamper-evident report and writes output with permission', async () => {
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
