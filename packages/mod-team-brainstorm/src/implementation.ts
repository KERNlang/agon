import type { AgonModFactory, CommandResult, Dispose, InvocationContext, Json, Registrar } from '@kernlang/agon-mod-api';
import type { TeamBrainstormModServices } from './host.js';
import type { TeamBrainstormEvent } from './runtime.js';

const schema = Object.freeze({
  type: 'object', additionalProperties: true, required: ['question'],
  properties: { question: { type: 'string' }, engines: { type: 'string' },
    members: { type: 'string', default: '2' }, timeout: { type: 'string', default: '300' },
    _: { type: 'array', items: { type: 'string' } } },
}) as Readonly<Record<string, Json>>;
const cli = Object.freeze({ positionals: ['question'], aliases: { engines: 'e', members: 'm' },
  descriptions: { question: 'Question to brainstorm' } });
const resultSchema = Object.freeze({
  type: 'object', additionalProperties: false, required: ['exitCode'],
  properties: {
    exitCode: { type: 'integer' }, stdout: { type: 'string' }, stderr: { type: 'string' },
    result: { type: 'object', additionalProperties: true },
  },
}) as Readonly<Record<string, Json>>;
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const extra = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
const failure = (message: string): CommandResult => ({ exitCode: 1, stderr: message + '\n' });

async function run(raw: Json, context: InvocationContext & { onWorkflowEvent?: (event: TeamBrainstormEvent) => void },
  services: TeamBrainstormModServices): Promise<CommandResult> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return failure('Provide a team brainstorm request object.');
  const input = raw as Record<string, Json>;
  const question = [text(input.question), ...extra(input._).filter(value => value !== input.question)].filter(Boolean).join(' ').trim();
  if (!question) return failure('Provide a question for team brainstorm.');
  const members = Number(input.members ?? 2);
  if (!Number.isFinite(members)) throw new Error('Team size must be a finite number');
  if (!Number.isInteger(members) || members < 1) return failure('Team size must be a positive integer.');
  const timeout = Number(input.timeout ?? 300);
  if (!Number.isFinite(timeout) || timeout < 1) return failure('Team timeout must be a positive number of seconds.');
  context.signal.throwIfAborted();
  let engines = typeof input.engines === 'string' ? input.engines.split(',').map(value => value.trim()).filter(Boolean) : [];
  if (!engines.length && services.engines.listActive) engines = [...await services.engines.listActive(context)];
  if (engines.length < 2) return failure('Team brainstorm requires at least 2 engines.');
  if (!services.teamBrainstorm || !services.runs) {
    return failure('Team Brainstorm host capabilities are unavailable. Restart with a compatible modular host.');
  }
  const invocation = services.teamBrainstorm.open(context);
  invocation.assertCurrent();
  const run = await services.runs.start('team-brainstorm', undefined, context);
  let result;
  try {
    invocation.assertCurrent();
    result = await invocation.run({
      question, context: text(input.context) || undefined, membersPerSide: members,
      engines, timeout, outputDir: run.path, onEvent: event => context.onWorkflowEvent?.(event),
    });
    invocation.assertCurrent();
    await services.runs.writeArtifact(run, 'team-result.json', JSON.stringify(result, null, 2) + '\n', context);
  } catch (error) {
    // Lost authority must not publish a stale run status.
    invocation.assertCurrent();
    const detail = error instanceof Error ? error.message : String(error);
    try {
      await services.runs.finish(run, {
        mode: 'team-brainstorm', startedAt: run.startedAt, endedAt: new Date().toISOString(),
        ok: false, summary: detail,
      }, context);
    } catch (storageError) {
      invocation.assertCurrent();
      throw new AggregateError([error, storageError], `Team Brainstorm failed: ${detail}; failure status could not be saved`);
    }
    invocation.assertCurrent();
    throw error;
  }
  invocation.assertCurrent();
  await services.runs.finish(run, {
    mode: 'team-brainstorm', startedAt: run.startedAt, endedAt: new Date().toISOString(),
    ok: true, summary: 'winner=' + (result.winnerTeamId ?? 'draw'),
  }, context);
  invocation.assertCurrent();
  await services.receipts.record('team-brainstorm', { winnerTeamId: result.winnerTeamId, members });
  invocation.assertCurrent();
  return { exitCode: 0, stdout: JSON.stringify(result, null, 2) + '\n', result: result as unknown as Json };
}
export const createMod:AgonModFactory=(services)=>Object.freeze({apiVersion:'1' as const,async activate(registrar:Registrar):Promise<Dispose>{const d:Dispose[]=[];const command={description:'Team brainstorm — teams collaborate and compete on a question',inputSchema:schema,cli,run:(input:Json,context:InvocationContext)=>run(input,context,services)};d.push(registrar.command('cli',{id:'cliCommands:0068',...command}));d.push(registrar.intent({id:'intentVariants:0059',description:'Parse team brainstorm',inputSchema:schema,parse:input=>{if(!/^\/team-brainstorm(?:\s|$)/i.test(input))return undefined;const parts=input.replace(/^\/team-brainstorm\s*/i,'').split(/\s+/);const size=parts[0]?.match(/^(\d+)v\d+$/i);return{question:parts.slice(size?1:0).join(' '),membersPerSide:size?Number(size[1]):undefined};},run:(input,context)=>{const parsed=input as Record<string,Json>;return run({...parsed,members:typeof parsed.membersPerSide==='number'?String(parsed.membersPerSide):parsed.members??'2'},context,services);}}));for(const id of ['builtinCommandMetadata:0044','tuiSlashCommands:0064'])d.push(registrar.command('tui',{id,...command}));d.push(registrar.planStep({id:'cesarRoutes:0061',inputSchema:schema,resultSchema,risk:'read',run:(input,context)=>run(input,context,services)}));return async()=>{for(const x of [...d].reverse())await x();};}});export default createMod;
