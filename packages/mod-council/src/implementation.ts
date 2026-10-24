import type { AgonModFactory, Dispose, Json, Registrar } from '@kernlang/agon-mod-api';
import { runCouncil } from './command.js';
export { runCouncil };
const schema = Object.freeze({ type: 'object', additionalProperties: true, properties: { question: { type: 'string' }, engines: { type: 'string' }, roles: { type: 'string' }, chairman: { type: 'string' }, timeout: { type: 'string', default: '120' }, json: { type: 'boolean' }, quiet: { type: 'boolean' }, label: { type: 'string' }, _: { type: 'array', items: { type: 'string' } } } }) as Readonly<Record<string, Json>>;
const cesarSchema = Object.freeze({ type: 'object', additionalProperties: false, required: ['question'], properties: { question: { type: 'string', minLength: 1 }, roles: { type: 'array', items: { type: 'string' } }, chairman: { type: 'string' } } }) as Readonly<Record<string, Json>>;
const cli = Object.freeze({ positionals: ['question'], aliases: { engines: 'e' }, descriptions: {
  question: 'The decision / question for the council to deliberate.',
  engines: 'Constrain the panel (comma-separated). Default: all active orchestration engines.',
  roles: 'Override advisor roles (comma-separated, priority order). Default: Contrarian,First-Principles,Red-Team,Outsider,Expansionist.',
  chairman: 'Force a specific engine to chair (skips rating-based selection).',
  timeout: 'Per-engine timeout in seconds.',
  json: 'Emit the full CouncilResult as JSON on stdout (pipe-friendly).',
  quiet: 'Print only the chairman verdict.',
  label: 'Human-readable suffix baked into the run dir name.',
} });
export const createMod: AgonModFactory = (services) => Object.freeze({ apiVersion: '1' as const, async activate(registrar: Registrar): Promise<Dispose> { const d: Dispose[] = []; const command = { description: 'Roundtable of active engines with directed critique and a chairman verdict', inputSchema: schema, cli, run: (input: Json, context: any) => runCouncil(input, context, services) }; d.push(registrar.command('cli', { id: 'cliCommands:0014', ...command, description: "Roundtable of ALL active engines — each takes a role, the top-rated engine chairs. `agon council \"<decision>\"`. Agon's stronger LLM-Council: real heterogeneous models, decision brief, directed critique, a chairman verdict with confidence + kill-switch.", run: (input, context) => runCouncil(input, context, services, true) })); d.push(registrar.command('tui', { id: 'tuiSlashCommands:0022', ...command, parse: (value: string) => ({ question: value.replace(/^\/council\s*/i, '') }) })); d.push(registrar.tool('cesar', { id: 'cesarTools:0005', description: 'Request a council delegation from the host orchestrator', inputSchema: cesarSchema, effect: 'read', run: async () => 'Council delegation accepted. End this turn so the orchestrator can convene the panel and continue with the verdict.' })); d.push(registrar.planStep({ id: 'physicalCesarRoutes:council', inputSchema: schema, resultSchema: schema, risk: 'read', run: (input, context) => runCouncil(input, context, services) })); for (const id of ['resultAndEnvelopeTypes:0039']) d.push(registrar.resultType({ id, schema: { type: 'object', additionalProperties: true }, readableVersions: '>=0.2.0', render: async (payload) => ({ text: JSON.stringify(payload, null, 2) }) }));
return async () => { for (const dispose of [...d].reverse()) await dispose(); }; } }); export default createMod;
