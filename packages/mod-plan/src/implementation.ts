import { commandResultToToolResult } from '@kernlang/agon-mod-api';
import { runPlanSession } from './session.js';
import type { InvocationContext } from '@kernlang/agon-mod-api';
import type { AgonModFactory, CommandResult, Dispose, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { listCesarPlans, loadCesarPlan, saveCesarPlan } from './execution-store.js';
import { createPlanProposal, exitCesarPlan } from './execution-state.js';
import { planExitRefusal } from './session-workflow.js';
import { planGraphError, planParallelWriterError } from './dependency-graph.js';
import { CESAR_PLAN_STATES, CESAR_STEP_TYPES } from './execution-model.js';
import type { CesarPlan, CesarPlanStep, CesarStepType } from './execution-model.js';
export { createPersistenceEnvelope, unwrapPersistenceEnvelope } from '@kernlang/agon-support-persistence';

const states = [...CESAR_PLAN_STATES];
const proposalSchema = Object.freeze({ type: 'object', additionalProperties: true, required: ['intent','steps'], properties: { intent: { type: 'string', minLength: 1 }, autoApprove: { type: 'boolean', default: false }, selfReview: { type: 'boolean', default: true }, steps: { type: 'array', minItems: 1, items: { type: 'object', required: ['id','type','description'], properties: { id: { type: 'string' }, type: { type: 'string' }, description: { type: 'string' }, dependsOn: { type: 'array', items: { type: 'string' } }, parallel: { type: 'boolean' }, estimatedTokens: { type: 'number' }, estimatedCostUsd: { type: 'number' } } } } } }) as Readonly<Record<string, Json>>;
const controlSchema = Object.freeze({ type: 'object', additionalProperties: true, properties: { planId: { type: 'string' }, reason: { type: 'string' }, limit: { type: 'number' }, state: { type: 'string', enum: states }, task: { type: 'string' }, _: { type: 'array', items: { type: 'string' } } } }) as Readonly<Record<string, Json>>;
const text = (value: Json | undefined): string => typeof value === 'string' ? value.trim() : '';

function validateSteps(raw: Json): { steps?: CesarPlanStep[]; error?: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'steps must be a non-empty array' };
  const steps: CesarPlanStep[] = [];
  const ids = new Set<string>();
  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'every step must be an object' };
    const item = value as Record<string, Json>; const id = text(item.id); const type = text(item.type); const description = text(item.description);
    if (!id || !type || !description) return { error: 'every step requires id, type, and description' };
    if (!CESAR_STEP_TYPES.includes(type as CesarStepType)) return { error: `unknown step type: ${type}` };
    if (ids.has(id)) return { error: `duplicate step ID: ${id}` }; ids.add(id);
    const dependsOn = Array.isArray(item.dependsOn) ? item.dependsOn.filter((entry): entry is string => typeof entry === 'string') : [];
    const estimatedTokens = Number(item.estimatedTokens ?? 0);
    const estimatedCostUsd = Number(item.estimatedCostUsd ?? 0);
    if (![estimatedTokens, estimatedCostUsd].every(value => Number.isFinite(value) && value >= 0)) return { error: `invalid estimate for step: ${id}` };
    const proposal = { ...item };
    // A proposal cannot supply evidence owned by the executor.
    for (const field of ['result', 'startedAt', 'completedAt', 'runDir', 'selfReviewCycle']) delete proposal[field];
    steps.push({ ...proposal, id, type: type as CesarStepType, description, dependsOn, parallel: item.parallel === true, state: dependsOn.length ? 'blocked' : 'pending', estimatedTokens, estimatedCostUsd });
  }
  const graphError = planGraphError(steps);
  if (graphError) return { error: graphError };
  const writerError = planParallelWriterError(steps);
  if (writerError) return { error: writerError };
  return { steps };
}

function recentPlans(): CesarPlan[] { return listCesarPlans().sort((a, b) => String(b.updatedAt ?? b.createdAt).localeCompare(String(a.updatedAt ?? a.createdAt))); }
function recent(planId?: string): CesarPlan | null { return planId ? loadCesarPlan(planId) : recentPlans()[0] ?? null; }
function summary(plan: CesarPlan): Json { return { id: plan.id, state: plan.state, intent: plan.intent, steps: plan.steps.length, done: plan.steps.filter((step) => step.state === 'done').length, estimatedTokens: plan.steps.reduce((sum, step) => sum + step.estimatedTokens, 0), estimatedCostUsd: plan.steps.reduce((sum, step) => sum + step.estimatedCostUsd, 0), createdAt: plan.createdAt, updatedAt: plan.updatedAt ?? plan.createdAt }; }

async function propose(raw: Json, services: ModServices): Promise<CommandResult> {
  const input = raw as Record<string, Json>; const intent = text(input.intent); if (!intent) return { exitCode: 1, stderr: 'Plan intent is required.\n' };
  const checked = validateSteps(input.steps ?? null); if (!checked.steps) return { exitCode: 1, stderr: `${checked.error}\n`, failure: { code: 'INVALID_PLAN', message: checked.error!, retryable: false } };
  const plan = createPlanProposal(intent, checked.steps, { autoApprove: input.autoApprove === true, selfReview: input.selfReview !== false });
  if (![plan.totalEstimatedTokens, plan.totalEstimatedCostUsd].every(Number.isFinite)) return { exitCode: 1, stderr: 'Total plan estimate exceeds the supported numeric range.\n' };
  saveCesarPlan(plan); const receiptId = await services.receipts.record('plan-proposed', plan as unknown as Json); const result = { plan, receiptId };
  return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n`, result: result as unknown as Json };
}

async function control(action: string, raw: Json, services: ModServices): Promise<CommandResult> {
  const input = raw as Record<string, Json>;
  if (action === 'plans') { const limit = Math.max(1, Math.min(100, Number(input.limit ?? 20))); const filter = text(input.state); const plans = recentPlans().filter((plan) => !filter || plan.state === filter).slice(0, limit).map(summary); return { exitCode: 0, stdout: `${JSON.stringify(plans, null, 2)}\n`, result: plans }; }
  if (action === 'propose') return propose(raw, services);
  const plan = recent(text(input.planId) || undefined); if (!plan) return { exitCode: 1, stderr: 'No matching plan found.\n' };
  if (action === 'plan') return { exitCode: 0, stdout: `${JSON.stringify(plan, null, 2)}\n`, result: plan as unknown as Json };
  if (action !== 'exit') return { exitCode: 1, stderr: `Unknown plan action: ${action}\n` };
  const refusal = planExitRefusal(plan);
  if (refusal) return { exitCode: 1, stderr: `${refusal}\n` };
  if (plan.state === 'done' || plan.state === 'cancelled') return { exitCode: 1, stderr: `Plan is already ${plan.state}.\n` };
  const next = exitCesarPlan(plan, text(input.reason) || 'plan mode exited');
  saveCesarPlan(next); const receiptId = await services.receipts.record(`plan-${action}`, { planId: next.id, previousState: plan.state, state: next.state }); return { exitCode: 0, stdout: `${JSON.stringify({ plan: next, receiptId }, null, 2)}\n`, result: { plan: next, receiptId } as unknown as Json };
}

const actions: Record<string, string> = { 'intentVariants:0003':'approve','intentVariants:0004':'auto','intentVariants:0008':'cancel','intentVariants:0046':'plan','intentVariants:0047':'plans','intentVariants:0050':'retry','builtinCommandMetadata:0003':'approve','builtinCommandMetadata:0004':'auto','builtinCommandMetadata:0009':'cancel','builtinCommandMetadata:0035':'plan','builtinCommandMetadata:0036':'plans','builtinCommandMetadata:0039':'retry','tuiKeyboardActions:0022':'approve','tuiKeyboardActions:0026':'cancel','tuiKeyboardActions:0038':'auto','tuiKeyboardActions:0041':'retry','tuiSlashCommands:0003':'approve','tuiSlashCommands:0004':'auto','tuiSlashCommands:0009':'cancel','tuiSlashCommands:0051':'plan','tuiSlashCommands:0052':'plans','tuiSlashCommands:0056':'retry' };
const cesar: Record<string, string> = { 'cesarRoutes:0038':'plan','cesarRoutes:0039':'propose','cesarRoutes:0056':'propose','cesarTools:0009':'exit','cesarTools:0014':'plans','cesarTools:0017':'propose' };

export const createMod: AgonModFactory = (services) => Object.freeze({ apiVersion: '1' as const, async activate(registrar: Registrar): Promise<Dispose> {
  const disposers: Dispose[] = [];
  const toolResult = async (operation: Promise<CommandResult>): Promise<Json> => { const output = await operation; return commandResultToToolResult(output); };
  for (const [id, action] of Object.entries(actions)) {
    const command = { id, description: `${action} in the interactive Plan session`, inputSchema: controlSchema, run: (input: Json, context: InvocationContext) => runPlanSession(action, input, services, context) };
    if (id.startsWith('intentVariants:')) disposers.push(registrar.intent({ ...command, parse: (value) => { const match=value.match(/^\/(\S+)(?:\s+([\s\S]*))?$/);if(!match)return undefined;const commandName=match[1].toLowerCase();const rest=(match[2]??'').trim();const aliases:Record<string,string>={autonomous:'auto',abort:'cancel',resume:'retry'};if((aliases[commandName]??commandName)!==action)return undefined;if(action==='auto')return{input:rest,taskClass:/^(fix|add|implement|refactor|debug|create|build|write|update|change|remove|delete|rename|move|test|deploy|install|upgrade|migrate|convert|extract|inline|optimize|port)\b/i.test(rest)?'code':/^(what|how|why|where|when|who|which|explain|describe|tell|show|list|is there|does)\b/i.test(rest)?'question':'ambiguous',autoMode:true};if(action==='plan'){if(/^resume(?:\s|$)/.test(rest))return{type:'plan-resume',planId:rest.slice(6).trim()||undefined};if(rest)return{type:'plan-task',task:rest};return{planId:undefined};}return action==='plans'?{}:{planId:rest.split(/\s+/)[0]||undefined}; } })); else disposers.push(registrar.command('tui', command));
  }
  disposers.push(registrar.tool('mcp', { id: 'mcpTools:0008', description: 'Exit plan mode and archive the current plan', inputSchema: controlSchema, effect: 'write', run: (input) => toolResult(control('exit', input, services)) }));
  disposers.push(registrar.tool('mcp', { id: 'mcpTools:0018', description: 'Propose a validated dependency-aware execution plan', inputSchema: proposalSchema, effect: 'write', run: (input) => toolResult(propose(input, services)) }));
  for (const [id, action] of Object.entries(cesar)) {
    const inputSchema = action === 'propose' ? proposalSchema : controlSchema;
    if (id.startsWith('cesarRoutes:')) disposers.push(registrar.planStep({ id, inputSchema, resultSchema: inputSchema, risk: action === 'plan' ? 'read' : 'workspace-write', run: (input) => control(action, input, services) }));
    else disposers.push(registrar.tool('cesar', { id, description: `${action} an execution plan`, inputSchema, effect: action === 'plans' || action === 'plan' ? 'read' : 'write', run: (input) => toolResult(control(action, input, services)) }));
  }
  return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
} });

export default createMod;
