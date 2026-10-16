import{execFileSync}from'node:child_process';import{existsSync,mkdtempSync,writeFileSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{describe,expect,it,vi}from'vitest';import type{ModServices,CommandContribution,Registrar}from'@kernlang/agon-mod-api';import{createMod,runConquerTask}from'./implementation.js';
import { assertContributionInput } from '@kernlang/agon-kernel';
import * as verification from '@kernlang/agon-support-verification';
import { afterEach } from 'vitest';
afterEach(() => vi.restoreAllMocks());
function repo(){const cwd=mkdtempSync(join(tmpdir(),'agon-conquer-'));execFileSync('git',['init'],{cwd});execFileSync('git',['config','user.email','c@example.invalid'],{cwd});execFileSync('git',['config','user.name','C'],{cwd});writeFileSync(join(cwd,'README.md'),'x\n');execFileSync('git',['add','.'],{cwd});execFileSync('git',['commit','-m','base'],{cwd});return cwd;}

it.each(['tui', 'argument-only', 'direct', 'canonical-precedence', 'deadline'] as const)('preserves %s turn, timeout and advisor selections', async (entry) => {
  const cwd = repo();
  const fitness = vi.spyOn(verification, 'runFitnessCommand');
  const started = Date.now();
  const dispatch = vi.fn(async (engineId, _prompt, _context, _options) => {
    if (entry === 'deadline') vi.spyOn(Date, 'now').mockReturnValue(started + 3_600_000);
    return { engineId, exitCode: 0, stdout: 'still working', stderr: '', timedOut: false };
  });
  const services = {
    identity: { id: 'agon.conquer', version: '1.0.0', contentHash: `sha256:${'a'.repeat(64)}` },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn() },
    receipts: { record: vi.fn(async () => 'fixture') },
    permissions: { check: vi.fn() }, state: { read: vi.fn(), write: vi.fn() },
    engines: {
      listActive: async () => ['builder', 'advisor-a', 'advisor-b'],
      rank: async (ids: readonly string[]) => ids.map(engineId => ({ engineId, reason: 'fixture', scope: null })),
      dispatch,
    },
  } as unknown as ModServices;
  let contribution: CommandContribution | undefined;
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'command' && args[0] === 'tui') contribution = args[1] as CommandContribution;
    return () => {};
  } }) as Registrar;
  await (await createMod(services)).activate(registrar);
  const parsed = await contribution!.parse!(`${entry === 'argument-only' ? '' : '/conquer '}build feature --gate false --builder builder --engines advisor-a --max-turns 1 --timeout 7 --gate-timeout 9 --max-hours 0.5`);
  const canonical = JSON.parse(JSON.stringify(parsed));
  assertContributionInput(contribution!.inputSchema, canonical);
  expect(canonical).toEqual({ task: 'build feature', gate: 'false', builder: 'builder', engineIds: ['advisor-a'], maxTurns: 1, turnTimeout: 7, gateTimeout: 9, maxHours: 0.5 });
  const input = entry === 'deadline'
    ? { ...canonical, maxTurns: 2 }
    : entry === 'direct'
    ? { task: 'build feature', gate: 'false', builder: 'builder', engineIds: ['advisor-a'], maxTurns: 1, turnTimeout: 7, gateTimeout: 9, maxHours: 0.5 }
    : entry === 'canonical-precedence'
      ? { ...canonical, engines: 'advisor-a', timeout: '7', engineIds: ['advisor-b'], turnTimeout: 99 }
      : canonical;
  const before = structuredClone(input);
  Object.freeze(input.engineIds);
  Object.freeze(input);
  const context = {
    invocationId: 'tui-options', cwd, platform: 'darwin-arm64', signal: new AbortController().signal, config: {},
  } as const;
  const result = entry === 'direct'
    ? await runConquerTask(input, context, services)
    : await contribution!.run(input, context);
  if (Symbol.asyncIterator in result) throw new Error('Unexpected streaming Conquer result');
  expect(result.exitCode).toBe(1);
  expect(result.result).toMatchObject({ status: entry === 'deadline' ? 'time_budget_exceeded' : 'turn_budget_exceeded', advisors: ['advisor-a'], turns: [expect.any(Object)] });
  expect(input).toEqual(before);
  expect(fitness).toHaveBeenCalledTimes(2);
  for (const call of fitness.mock.calls) {
    expect(call[0]).toBe('false');
    expect(call[1]).not.toBe(cwd);
    expect(call[2]).toBe(9);
    expect(call[3]).toBe(context.signal);
  }
  expect(dispatch).toHaveBeenCalledOnce();
  expect(dispatch.mock.calls[0][0]).toBe('builder');
  expect(dispatch.mock.calls[0][3]).toMatchObject({ timeoutSeconds: 7 });
});
describe('physical conquer mod',()=>{it('iterates in one isolated worktree until the gate, then receipts the patch and cleans up',async()=>{const cwd=repo();let agentTurns=0;const paths:string[]=[];const dispatch=vi.fn(async(id:string,prompt:string,context:any,options:any)=>{if(options.mode==='agent'){agentTurns++;paths.push(context.cwd);if(agentTurns===2)writeFileSync(join(context.cwd,'solved.txt'),'yes\n');return{id,exitCode:0,stdout:'worked',stderr:'',timedOut:false};}return{id,exitCode:0,stdout:'VERDICT: CONTINUE\nCONFIDENCE: 80',stderr:'',timedOut:false};});const services={identity:{id:'agon.conquer',version:'1',contentHash:`sha256:${'a'.repeat(64)}`},source:'bundled',logger:{debug:vi.fn(),info:vi.fn(),warn:vi.fn()},receipts:{record:vi.fn(async()=>'conquer-r')},permissions:{check:vi.fn()},state:{read:vi.fn(),write:vi.fn()},engines:{listActive:vi.fn(async()=>['builder','a','b']),rank:vi.fn(async(ids:readonly string[])=>ids.map(engineId=>({engineId,reason:'none',scope:null}))),dispatch}}as unknown as ModServices;const out=await runConquerTask({task:'solve',gate:'test -f solved.txt',builder:'builder',engines:'a,b',maxTurns:'3'}, {invocationId:'c',cwd,platform:'darwin-arm64',signal:new AbortController().signal,config:{}},services);expect(out.exitCode).toBe(0);expect((out.result as any).turns).toHaveLength(2);expect((out.result as any).winningPatch).toContain('solved.txt');expect(existsSync(join(cwd,'solved.txt'))).toBe(false);expect(paths.every(path=>!existsSync(path))).toBe(true);});});
