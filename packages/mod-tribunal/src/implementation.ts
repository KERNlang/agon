import type { AgonModFactory, CommandResult, Dispose, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

type Mode = 'adversarial' | 'socratic' | 'red-team' | 'steelman' | 'synthesis' | 'postmortem';
type Protocol = 'parallel' | 'chained' | 'hybrid';
const modes = new Set<Mode>(['adversarial', 'socratic', 'red-team', 'steelman', 'synthesis', 'postmortem']);
const protocols = new Set<Protocol>(['parallel', 'chained', 'hybrid']);
const schema = Object.freeze({ type: 'object', additionalProperties: true, required: ['question'], properties: { question: { type: 'string' }, rounds: { type: 'string', default: '2' }, engines: { type: 'string' }, mode: { type: 'string', default: 'adversarial' }, protocol: { type: 'string', default: 'auto' }, timeout: { type: 'string', default: '120' }, label: { type: 'string' }, quiet: { type: 'boolean' }, _: { type: 'array', items: { type: 'string' } } } }) as Readonly<Record<string, Json>>;
const cesarSchema = Object.freeze({ type: 'object', additionalProperties: false, required: ['question'], properties: { question: { type: 'string', minLength: 1 }, mode: { type: 'string', enum: ['adversarial', 'synthesis', 'steelman', 'socratic', 'red-team', 'postmortem'] }, team: { type: 'boolean' } } }) as Readonly<Record<string, Json>>;
const cli = Object.freeze({ positionals: ['question'], aliases: { rounds: 'r', engines: 'e', mode: 'm', protocol: 'p' }, descriptions: { question: 'Question to debate' } });
const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const extras = (value: unknown) => Array.isArray(value) ? value.map(String) : [];
const ids = (value: Json | undefined) => typeof value === 'string' ? value.split(',').map((id) => id.trim()).filter(Boolean) : [];

export function parseTribunalIntent(input: string): Record<string, Json> | undefined {
  const match = input.match(/^\/tribunal(?:\s+([\s\S]*))?$/i);
  if (!match) return undefined;
  const parts = (match[1] ?? '').trim().split(/\s+/).filter(Boolean);
  const acceptedModes = new Set(['adversarial', 'socratic', 'red-team', 'steelman', 'synthesis', 'postmortem']);
  const acceptedProtocols = new Set(['auto', 'parallel', 'chained', 'hybrid']);
  let tribunalMode: string | undefined;
  let tribunalProtocol: string | undefined;
  const question: string[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const token = parts[index];
    const lower = token.toLowerCase();
    if (lower === '--mode' && acceptedModes.has(parts[index + 1]?.toLowerCase())) { tribunalMode = parts[++index].toLowerCase(); continue; }
    if (lower === '--protocol' && acceptedProtocols.has(parts[index + 1]?.toLowerCase())) { tribunalProtocol = parts[++index].toLowerCase(); continue; }
    const shorthand = lower.startsWith('--') ? lower.slice(2) : lower;
    if (!tribunalMode && question.length === 0 && acceptedModes.has(shorthand)) { tribunalMode = shorthand; continue; }
    question.push(token);
  }
  return { question: question.join(' '), ...(tribunalMode ? { tribunalMode } : {}), ...(tribunalProtocol ? { tribunalProtocol } : {}) };
}

function config(mode: Mode, count: number): { roles: string[]; protocol: Protocol; maxRounds: number; summary: string } {
  if (mode === 'adversarial') return { roles: count === 2 ? ['Argue FOR', 'Argue AGAINST'] : ['Argue FOR', 'Argue AGAINST', "Devil's advocate", ...Array.from({ length: Math.max(0, count - 3) }, (_, i) => `Perspective ${i + 4}`)], protocol: 'hybrid', maxRounds: 3, summary: 'Give a decisive verdict, key insights, and recommendation.' };
  if (mode === 'socratic') return { roles: ['Questioner', 'Responder', ...Array.from({ length: Math.max(0, count - 2) }, () => 'Observer')], protocol: 'chained', maxRounds: 3, summary: 'List resolved questions, unresolved assumptions, key insight, and next steps.' };
  if (mode === 'red-team') return { roles: ['Defender', ...Array.from({ length: Math.max(1, count - 1) }, (_, i) => `Attacker ${i + 1}`)], protocol: 'hybrid', maxRounds: 2, summary: 'Produce a severity/likelihood risk register and go/no-go assessment.' };
  if (mode === 'steelman') return { roles: ['Advocate', 'Steelman opponent', ...Array.from({ length: Math.max(0, count - 2) }, () => 'Judge')], protocol: 'chained', maxRounds: 2, summary: 'Judge both strongest cases, identify the crux, and recommend.' };
  if (mode === 'synthesis') return { roles: ['Proposer A', 'Proposer B', ...Array.from({ length: Math.max(0, count - 2) }, () => 'Synthesizer')], protocol: 'parallel', maxRounds: 2, summary: 'Build a decision matrix, name the best option, trade-offs, and next steps.' };
  return { roles: ['Timeline analyst', 'Root-cause investigator', ...Array.from({ length: Math.max(0, count - 2) }, () => 'Prevention designer')], protocol: 'chained', maxRounds: 2, summary: 'Write a timeline, systemic root cause, detection gap, prevention plan, and actions.' };
}

export async function runTribunal(raw: Json, context: Parameters<ModServices['engines']['dispatch']>[2], services: ModServices): Promise<CommandResult> {
  const input = raw as Record<string, Json>;
  const question = [text(input.question), ...extras(input._).filter((part) => part !== input.question)].filter(Boolean).join(' ').trim();
  if (!question) return { exitCode: 1, stderr: 'Provide a question. Usage: agon tribunal "question"\n' };
  let engines = ids(input.engines); if (!engines.length && services.engines.listActive) engines = [...await services.engines.listActive(context)]; engines = engines.slice(0, 4);
  if (engines.length < 2) return { exitCode: 1, stderr: `Tribunal needs at least 2 engines. Only found: ${engines.join(', ') || 'none'}\n` };
  const modeText = text(input.mode) || 'adversarial'; if (!modes.has(modeText as Mode)) return { exitCode: 1, stderr: `Invalid tribunal mode: ${modeText}\n` }; const mode = modeText as Mode;
  const cfg = config(mode, engines.length); const requestedProtocol = (text(input.protocol) || 'auto').toLowerCase();
  if (requestedProtocol !== 'auto' && !protocols.has(requestedProtocol as Protocol)) return { exitCode: 1, stderr: `Invalid tribunal protocol: ${requestedProtocol}\n` };
  const protocol = requestedProtocol === 'auto' ? cfg.protocol : requestedProtocol as Protocol;
  const rounds = Math.max(1, Math.min(cfg.maxRounds, Number.parseInt(text(input.rounds) || '2', 10))); const timeoutSeconds = Math.max(1, Number.parseInt(text(input.timeout) || '120', 10));
  const positions = engines.map((engineId, index) => ({ engineId, position: cfg.roles[index] ?? `Participant ${index + 1}`, arguments: [] as string[] }));
  const failures: { engineId: string; round: number; error: string }[] = []; const roundResults: { round: number; positions: { engineId: string; position: string; argument: string }[] }[] = [];
  const dispatch = async (engineId: string, prompt: string, round: number) => { try { const output = await services.engines.dispatch(engineId, prompt, context, { timeoutSeconds, systemPrompt: 'You are a debate participant. Respond directly with evidence and reasoning. Do not use tools.' }) as Record<string, Json>; const content = output.exitCode === 0 && output.timedOut !== true ? text(output.stdout).replace(/<think>[\s\S]*?<\/think>\s*/gi, '').trim() : ''; if (!content) throw new Error(text(output.stderr) || 'no visible response'); return content; } catch (error) { failures.push({ engineId, round, error: error instanceof Error ? error.message : String(error) }); return '(failed to respond)'; } };
  for (let round = 1; round <= rounds && !context.signal.aborted; round++) {
    const prior = positions.map((position) => `${position.engineId} (${position.position}): ${position.arguments.at(-1) ?? ''}`).join('\n\n');
    const one = async (position: typeof positions[number], earlier = '') => dispatch(position.engineId, `ROLE: ${position.position}\nQUESTION: ${question}\nMODE: ${mode}\nROUND: ${round}/${rounds}\n${prior ? `PREVIOUS ROUND:\n${prior}\n` : ''}${earlier ? `EARLIER THIS ROUND:\n${earlier}\n` : ''}Argue your assigned role concretely and counter other positions.`, round);
    const parallel = protocol === 'parallel' || (protocol === 'hybrid' && round === 1); const outputs: string[] = [];
    if (parallel) outputs.push(...await Promise.all(positions.map((position) => one(position))));
    else for (const position of positions) outputs.push(await one(position, outputs.map((argument, index) => `${positions[index].engineId}: ${argument}`).join('\n\n')));
    outputs.forEach((argument, index) => positions[index].arguments.push(argument));
    roundResults.push({ round, positions: positions.map((position, index) => ({ engineId: position.engineId, position: position.position, argument: outputs[index] })) });
  }
  const debate = positions.map((position) => `${position.engineId} (${position.position}):\n${position.arguments.join('\n\n')}`).join('\n\n---\n\n');
  let summary = debate; try { const output = await services.engines.dispatch(engines[0], `QUESTION: ${question}\n\nDEBATE:\n${debate}\n\nTASK: ${cfg.summary}`, context, { timeoutSeconds, systemPrompt: 'Synthesize the debate. Be decisive and evidence-oriented. Do not use tools.' }) as Record<string, Json>; if (output.exitCode === 0 && text(output.stdout)) summary = text(output.stdout); } catch { /* evidence remains in the raw debate */ }
  const responded = positions.filter((position) => position.arguments.some((argument) => argument !== '(failed to respond)')).length; const result = { question, mode, protocol, rounds: roundResults, positions, summary, panelHealth: { requested: engines.length * rounds, responded: engines.length * rounds - failures.length, degraded: failures.length > 0, failures } };
  if (!responded) return { exitCode: 1, stderr: 'Tribunal produced no usable arguments.\n', result: result as Json };
  await services.receipts.record('tribunal', { mode, protocol, rounds, engines: engines.length, failures: failures.length });
  return input.quiet === true ? { exitCode: 0, stdout: `${summary}\n`, result: result as Json } : { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n`, result: result as Json };
}

export const createMod: AgonModFactory = (services) => Object.freeze({ apiVersion: '1' as const, async activate(registrar: Registrar): Promise<Dispose> { const disposers: Dispose[] = []; const command = { description: 'Adversarial debate — engines argue different sides of a question', inputSchema: schema, cli, run: (input: Json, context: any) => runTribunal(input, context, services) }; disposers.push(registrar.command('cli', { id: 'cliCommands:0072', ...command })); for (const id of ['intentVariants:0057', 'intentVariants:0063']) disposers.push(registrar.intent({ id, description: 'Parse tribunal intent', inputSchema: schema, parse: parseTribunalIntent, run: (value, context) => runTribunal(value, context, services) })); for (const id of ['builtinCommandMetadata:0048', 'tuiSlashCommands:0069']) disposers.push(registrar.command('tui', { id, ...command })); disposers.push(registrar.tool('mcp', { id: 'mcpTools:0032', description: 'Run an adversarial tribunal', inputSchema: schema, effect: 'process', run: async (input, context) => (await runTribunal(input, context, services)).result ?? {} })); for (const id of ['cesarRoutes:0066', 'cesarRoutes:0067', 'cesarRoutes:0068', 'cesarRoutes:0069']) disposers.push(registrar.planStep({ id, inputSchema: schema, resultSchema: schema, risk: 'read', run: (input, context) => runTribunal(input, context, services) })); disposers.push(registrar.tool('cesar', { id: 'cesarTools:0026', description: 'Hand this question to an adversarial Tribunal', inputSchema: cesarSchema, effect: 'read', run: async () => 'Delegation accepted — end your turn now so the run can start.' })); disposers.push(registrar.resultType({ id: 'resultAndEnvelopeTypes:0139', schema: { type: 'object', additionalProperties: true }, readableVersions: '>=0.2.0', render: async (payload) => ({ text: JSON.stringify(payload, null, 2) }) })); return async () => { for (const dispose of [...disposers].reverse()) await dispose(); }; } });
export default createMod;
