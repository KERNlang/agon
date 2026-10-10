import{describe,expect,it,vi}from'vitest';import type{CommandContribution, InvocationContext, ModServices, Registrar}from'@kernlang/agon-mod-api';import{createMod, ModularJobService}from'./implementation.js';
const services=()=>({state:{write:vi.fn(),read:vi.fn()},receipts:{record:vi.fn()},logger:{debug:vi.fn(),info:vi.fn(),warn:vi.fn()},permissions:{check:vi.fn()},engines:{dispatch:vi.fn()},identity:{},source:'bundled'})as unknown as ModServices;
import { JobService } from './job-service.js';

it('reverses partial activation and invalidates cached handlers', async () => {
  const host = services();
  const commands: CommandContribution[] = [];
  const cleaned: number[] = [];
  let registered = 0;
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (++registered === 4) throw new Error('registration failed');
    const index = registered;
    if (method === 'command') commands.push(args[1] as CommandContribution);
    return () => { cleaned.push(index); };
  } }) as Registrar;
  await expect((await createMod(host)).activate(registrar, host)).rejects.toThrow('registration failed');
  expect(cleaned).toEqual([3, 2, 1]);
  const context = { invocationId: 'fixture', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {} } as InvocationContext;
  await expect(commands[0].run({}, context)).rejects.toThrow('Jobs service is closed');
});

it('bounds outstanding job records when storage stalls across many completed jobs', async () => {
  const host = services();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  vi.mocked(host.state.write).mockImplementation(() => blocked);
  const jobs = new ModularJobService(host, 1, 10, 2);
  try {
    for (let index = 0; index < 2; index++) {
      const job = jobs.submit('fixture', String(index), async () => 'done');
      await jobs.wait(job.id);
    }
    for (let index = 0; index < 50; index++) {
      expect(() => jobs.submit('fixture', 'overflow', async () => 'unexpected')).toThrow('Jobs persistence backlog is full');
      expect(() => jobs.createManual('fixture', 'overflow')).toThrow('Jobs persistence backlog is full');
    }
    expect(host.state.write).toHaveBeenCalledTimes(1);
  } finally { release(); }
  await jobs.flushPersistence();
  const recovered = jobs.submit('fixture', 'recovered', async () => 'recovered');
  expect((await jobs.wait(recovered.id))?.value).toBe('recovered');
  await jobs.flushPersistence();
});

it('rejects an IPC submission whose capability probe finishes after disposal', async () => {
  const host = services();
  let release!: (reply: { type: 'pong'; capabilities: string[] }) => void;
  const sendRequest = vi.fn(() => new Promise<{ type: 'pong'; capabilities: string[] }>(resolve => { release = resolve; }));
  const commands = new Map<string, CommandContribution>();
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'command' && args[0] === 'cli') { const command = args[1] as CommandContribution; commands.set(command.id, command); }
    return vi.fn();
  } }) as Registrar;
  const dispose = await (await createMod(host)).activate(registrar, host);
  const context = { invocationId: 'fixture', cwd: process.cwd(), platform: 'darwin-arm64' as const, signal: new AbortController().signal, config: {},
    jobCli: { sendRequest, startDaemon: vi.fn(), log: vi.fn(), error: vi.fn(), stdout: { write: vi.fn() }, stderr: { write: vi.fn() }, setExitCode: vi.fn() },
  };
  const submission = commands.get('cliCommands:0032')!.run({ kind: 'review', input: 'test', waitTimeoutMs: '0' }, context);
  const rejected = expect(submission).rejects.toThrow('Jobs service is closed');
  await dispose?.();
  release({ type: 'pong', capabilities: ['jobs-v1'] });
  await rejected;
  expect(sendRequest).toHaveBeenCalledTimes(1);
  expect(host.engines.dispatch).not.toHaveBeenCalled();
  expect(host.state.write).not.toHaveBeenCalled();
});

it('bounds the persisted scheduler flush when storage never settles', async () => {
  vi.useFakeTimers();
  try {
    const host = services();
    vi.mocked(host.state.write).mockImplementation(() => new Promise(() => {}));
    const jobs = new ModularJobService(host);
    const job = jobs.submit('fixture', 'pending storage', async () => 'done');
    await jobs.wait(job.id);
    jobs.close();
    const failure = expect(jobs.flushPersistence()).rejects.toThrow('Jobs persistence did not finish');
    await vi.advanceTimersByTimeAsync(20_001);
    await failure;
  } finally { vi.useRealTimers(); }
});

it('attempts every unregister in reverse order and retains cleanup failures', async () => {
  const host = services();
  const order: number[] = [];
  const cleanups: ReturnType<typeof vi.fn>[] = [];
  const registrar = new Proxy({}, { get: () => () => {
    const index = cleanups.length;
    const cleanup = vi.fn(() => { order.push(index); if (index < 2) throw new Error('cleanup ' + index); });
    cleanups.push(cleanup);
    return cleanup;
  } }) as Registrar;
  const dispose = await (await createMod(host)).activate(registrar, host);
  let failure: unknown;
  try { await dispose?.(); } catch (error) { failure = error; }
  expect(cleanups.length).toBeGreaterThan(1);
  expect(cleanups.every(cleanup => cleanup.mock.calls.length === 1)).toBe(true);
  expect(order).toEqual([...cleanups.keys()].reverse());
  expect(failure).toBeInstanceOf(AggregateError);
  expect((failure as AggregateError).errors.map((error: Error) => error.message)).toEqual(['cleanup 1', 'cleanup 0']);
  expect(host.state.write).not.toHaveBeenCalled();
});

it('does not create a local scheduler when CLI transport is absent', async () => {
  const host = services();
  const commands = new Map<string, CommandContribution>();
  const registrar = new Proxy({}, { get: (_, method) => (...args: unknown[]) => {
    if (method === 'command' && args[0] === 'cli') { const command = args[1] as CommandContribution; commands.set(command.id, command); }
    return vi.fn();
  } }) as Registrar;
  const dispose = await (await createMod(host)).activate(registrar, host);
  const context = { invocationId: 'fixture', cwd: process.cwd(), platform: 'darwin-arm64', signal: new AbortController().signal, config: {} } as InvocationContext;
  expect(await commands.get('cliCommands:0032')!.run({ kind: 'review', input: 'test' }, context)).toMatchObject({ exitCode: 2 });
  await dispose?.();
  expect(host.engines.dispatch).not.toHaveBeenCalled();
  expect(host.state.write).not.toHaveBeenCalled();
});

it('reports failed writes without unhandled promise rejections', async () => {
  const host = services();
  vi.mocked(host.state.write).mockRejectedValue(new Error('fixture disk full'));
  const jobs = new ModularJobService(host);
  const job = jobs.submit('fixture', 'failed persistence', async () => 'done');
  await jobs.wait(job.id);
  await expect(jobs.flushPersistence()).rejects.toThrow('fixture disk full');
  expect(host.logger.warn).toHaveBeenCalledWith('Jobs state write failed', { error: 'fixture disk full' });
});

it('coalesces pending observations while one write is blocked', async () => {
  const host = services();
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let writes = 0;
  vi.mocked(host.state.write).mockImplementation(async () => { if (++writes === 1) await blocked; });
  const jobs = new ModularJobService(host);
  const job = jobs.submit('fixture', 'bounded pending writes', async ({ emit }) => {
    for (let index = 0; index < 500; index++) emit('progress', index);
    return 'done';
  });
  try {
    await jobs.wait(job.id);
    expect(writes).toBe(1);
  } finally { release(); }
  await jobs.flushPersistence();
  expect(writes).toBe(2);
  expect(vi.mocked(host.state.write).mock.calls.at(-1)?.[1]).toMatchObject({ status: 'succeeded' });
});

it('uses the canonical scheduler rather than a second queue implementation', () => {
  expect(new ModularJobService(services())).toBeInstanceOf(JobService);
});

it('cannot overwrite terminal state with an older slow write', async () => {
  const host = services();
  let release!: () => void;
  const slowWrite = new Promise<void>(resolve => { release = resolve; });
  let stored: unknown;
  let calls = 0;
  vi.mocked(host.state.write).mockImplementation(async (_key, value) => {
    if (++calls === 1) await slowWrite;
    stored = value;
  });
  const jobs = new ModularJobService(host);
  const job = jobs.submit('fixture', 'ordered state', async () => 'done');
  try { await jobs.wait(job.id); }
  finally { release(); }
  await new Promise<void>(resolve => setImmediate(resolve));
  expect(stored).toMatchObject({ status: 'succeeded', payload: { outcome: { state: 'succeeded', value: 'done' } } });
  expect(Object.keys((stored as { payload: object }).payload).sort()).toEqual(['events', 'outcome', 'snapshot']);
});
describe('physical jobs mod',()=>{it('bounds concurrency, records events, and returns outcomes',async()=>{const s=services();const jobs=new ModularJobService(s,1);let release!:()=>void;const first=jobs.submit('a','first',async({emit})=>{emit('stdout','hello');await new Promise<void>(r=>release=r);return'ok';});const second=jobs.submit('b','second',async()=> 'two');expect(jobs.get(first.id)?.state).toBe('running');expect(jobs.get(second.id)?.state).toBe('queued');await new Promise(r=>setTimeout(r,0));release();expect((await jobs.wait(first.id))?.state).toBe('succeeded');expect((await jobs.wait(second.id))?.value).toBe('two');expect(jobs.events(first.id)?.events.map(x=>x.type)).toContain('stdout');expect(s.state.write).toHaveBeenCalled();});it('cancels queued work without executing it',async()=>{const jobs=new ModularJobService(services(),1);let release!:()=>void;jobs.submit('a','block',async()=>{await new Promise<void>(r=>release=r);return'ok';});const fn=vi.fn(async()=> 'bad');const queued=jobs.submit('b','queued',fn);expect(jobs.cancel(queued.id)).toBe(true);expect((await jobs.wait(queued.id))?.state).toBe('cancelled');await new Promise(r=>setTimeout(r,0));release();await new Promise(r=>setTimeout(r,0));expect(fn).not.toHaveBeenCalled();});});
