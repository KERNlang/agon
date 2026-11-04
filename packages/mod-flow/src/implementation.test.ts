import{mkdirSync,mkdtempSync,writeFileSync}from'node:fs';import{tmpdir}from'node:os';import{join}from'node:path';import{afterEach,describe,expect,it,vi}from'vitest';import type{CommandResult,ModServices,Registrar}from'@kernlang/agon-mod-api';import{createMod,runFlow}from'./implementation.js';const old=process.env.AGON_HOME;afterEach(()=>{if(old===undefined)delete process.env.AGON_HOME;else process.env.AGON_HOME=old;});const services={receipts:{record:vi.fn(async()=> 'f')}}as unknown as ModServices;describe('physical flow mod',()=>{it('lists and analyzes persisted flow records while skipping malformed data',async()=>{const h=mkdtempSync(join(tmpdir(),'flow-'));process.env.AGON_HOME=h;mkdirSync(join(h,'flows'));writeFileSync(join(h,'flows','flow-good-a.json'),JSON.stringify({id:'a',schemaVersion:1,mode:'forge',startedAt:new Date().toISOString(),endedAt:new Date().toISOString(),completionState:'completed',captureMethod:'auto',telemetry:{engines:['a'],durationMs:10,tokensByEngine:{a:{prompt:2,response:3}}}}));writeFileSync(join(h,'flows','flow-bad-b.json'),'{');expect(((await runFlow({},{}as any,services,true)).result as any).flow).toHaveLength(1);expect(((await runFlow({},{}as any,services)).result as any).flow.totalFlows).toBe(1);});});
describe('flow mod surfaces', () => {
  it('keeps /flow and /flows on telemetry when the graph command shares the flow id on the cli surface', async () => {
    process.env.AGON_HOME = mkdtempSync(join(tmpdir(), 'flow-'));
    const commands = new Map<string, { surface: string; run: (input: never, context: never) => Promise<CommandResult> | CommandResult }>();
    const registrar = {
      command: (surface: string, contribution: { id: string; run: never }) => { commands.set(contribution.id, { surface, run: contribution.run }); return () => {}; },
      intent: () => () => {},
    } as unknown as Registrar;
    await createMod(services).activate(registrar, services);
    expect(commands.get('physicalCliCommands:flow')?.surface).toBe('cli');
    expect(commands.get('physicalCliCommands:flow-validate')?.surface).toBe('cli');
    const slash = async (id: string) => {
      const entry = commands.get(id);
      expect(entry?.surface).toBe('tui');
      return ((await entry!.run({} as never, {} as never)).result as { flow: unknown }).flow;
    };
    expect((await slash('tuiSlashCommands:0030')) as { totalFlows: number }).toMatchObject({ totalFlows: 0 });
    expect(await slash('tuiSlashCommands:0031')).toEqual([]);
  });
});
