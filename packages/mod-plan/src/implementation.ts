import { commandResultToToolResult } from '@kernlang/agon-mod-api';
import { randomUUID } from 'node:crypto';
import { runPlanSession } from './session.js';
import type { InvocationContext } from '@kernlang/agon-mod-api';
import type { AgonModFactory, CommandResult, Dispose, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';
import { listPersistedPlans, loadPersistedPlan, savePersistedPlan } from '@kernlang/agon-support-persistence';
export { createPersistenceEnvelope, unwrapPersistenceEnvelope } from '@kernlang/agon-support-persistence';

type PlanState = 'awaiting_approval' | 'running' | 'paused' | 'done' | 'cancelled';
type Step = { id: string; type: string; description: string; dependsOn: string[]; parallel: boolean; state: 'pending' | 'blocked' | 'done' | 'failed' | 'cancelled'; estimatedTokens: number; estimatedCostUsd: number; [key: string]: Json };
type Plan = { id: string; state: PlanState; intent: string; steps: Step[]; autoApprove: boolean; selfReview: boolean; createdAt: string; updatedAt: string; approvedAt?: string; exitReason?: string };
const states: PlanState[] = ['awaiting_approval','running','paused','done','cancelled'];
const proposalSchema = Object.freeze({ type: 'object', additionalProperties: true, required: ['intent','steps'], properties: { intent: { type: 'string', minLength: 1 }, autoApprove: { type: 'boolean', default: false }, selfReview: { type: 'boolean', default: true }, steps: { type: 'array', minItems: 1, items: { type: 'object', required: ['id','type','description'], properties: { id: { type: 'string' }, type: { type: 'string' }, description: { type: 'string' }, dependsOn: { type: 'array', items: { type: 'string' } }, parallel: { type: 'boolean' }, estimatedTokens: { type: 'number' }, estimatedCostUsd: { type: 'number' } } } } } }) as Readonly<Record<string, Json>>;
const controlSchema = Object.freeze({ type: 'object', additionalProperties: true, properties: { planId: { type: 'string' }, reason: { type: 'string' }, limit: { type: 'number' }, state: { type: 'string', enum: states }, task: { type: 'string' }, _: { type: 'array', items: { type: 'string' } } } }) as Readonly<Record<string, Json>>;
const text = (value: Json | undefined): string => typeof value === 'string' ? value.trim() : '';

function validateSteps(raw: Json): { steps?: Step[]; error?: string } {
  if (!Array.isArray(raw) || raw.length === 0) return { error: 'steps must be a non-empty array' };
  const steps: Step[] = [];
  const ids = new Set<string>();
  for (const value of raw) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return { error: 'every step must be an object' };
    const item = value as Record<string, Json>; const id = text(item.id); const type = text(item.type); const description = text(item.description);
    if (!id || !type || !description) return { error: 'every step requires id, type, and description' };
    if (ids.has(id)) return { error: `duplicate step ID: ${id}` }; ids.add(id);
    const dependsOn = Array.isArray(item.dependsOn) ? item.dependsOn.filter((entry): entry is string => typeof entry === 'string') : [];
    steps.push({ ...item, id, type, description, dependsOn, parallel: item.parallel === true, state: dependsOn.length ? 'blocked' : 'pending', estimatedTokens: Number(item.estimatedTokens ?? 0), estimatedCostUsd: Number(item.estimatedCostUsd ?? 0) });
  }
  for (const step of steps) for (const dependency of step.dependsOn) if (!ids.has(dependency)) return { error: `step "${step.id}" depends on unknown step "${dependency}"` };
  const visiting = new Set<string>(); const visited = new Set<string>(); const byId = new Map(steps.map((step) => [step.id, step]));
  const cycle = (id: string): boolean => { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); for (const dependency of byId.get(id)?.dependsOn ?? []) if (cycle(dependency)) return true; visiting.delete(id); visited.add(id); return false; };
  for (const step of steps) if (cycle(step.id)) return { error: `circular dependency involving step "${step.id}"` };
  const parallelWriters = steps.filter((step) => step.parallel && ['forge','teamforge','pipeline','agent','team-agent'].includes(step.type));
  if (parallelWriters.length > 1) return { error: `parallel workspace writers require explicit serialization: ${parallelWriters.map((step) => step.id).join(', ')}` };
  return { steps };
}

function recent(planId?: string): Plan | null { return planId ? loadPersistedPlan<Plan>(planId) : listPersistedPlans<Plan>(1)[0] ?? null; }
function summary(plan: Plan): Json { return { id: plan.id, state: plan.state, intent: plan.intent, steps: plan.steps.length, done: plan.steps.filter((step) => step.state === 'done').length, estimatedTokens: plan.steps.reduce((sum, step) => sum + step.estimatedTokens, 0), estimatedCostUsd: plan.steps.reduce((sum, step) => sum + step.estimatedCostUsd, 0), createdAt: plan.createdAt, updatedAt: plan.updatedAt }; }

async function propose(raw: Json, services: ModServices): Promise<CommandResult> {
  const input = raw as Record<string, Json>; const intent = text(input.intent); if (!intent) return { exitCode: 1, stderr: 'Plan intent is required.\n' };
  const checked = validateSteps(input.steps ?? null); if (!checked.steps) return { exitCode: 1, stderr: `${checked.error}\n`, failure: { code: 'INVALID_PLAN', message: checked.error!, retryable: false } };
  const now = new Date().toISOString(); const plan: Plan = { id: `cplan-${randomUUID()}`, state: input.autoApprove === true ? 'running' : 'awaiting_approval', intent, steps: checked.steps, autoApprove: input.autoApprove === true, selfReview: input.selfReview !== false, createdAt: now, updatedAt: now, ...(input.autoApprove === true ? { approvedAt: now } : {}) };
  savePersistedPlan(plan); const receiptId = await services.receipts.record('plan-proposed', plan as unknown as Json); const result = { plan, receiptId };
  return { exitCode: 0, stdout: `${JSON.stringify(result, null, 2)}\n`, result: result as unknown as Json };
}

async function control(action: string, raw: Json, services: ModServices): Promise<CommandResult> {
  const input = raw as Record<string, Json>;
  if (action === 'plans') { const limit = Math.max(1, Math.min(100, Number(input.limit ?? 20))); const filter = text(input.state); const plans = listPersistedPlans<Plan>(limit * 2).filter((plan) => !filter || plan.state === filter).slice(0, limit).map(summary); return { exitCode: 0, stdout: `${JSON.stringify(plans, null, 2)}\n`, result: plans }; }
  if (action === 'propose') return propose(raw, services);
  const plan = recent(text(input.planId) || undefined); if (!plan) return { exitCode: 1, stderr: 'No matching plan found.\n' };
  if (action === 'plan') return { exitCode: 0, stdout: `${JSON.stringify(plan, null, 2)}\n`, result: plan as unknown as Json };
  const now = new Date().toISOString(); let next: Plan;
  if (action === 'approve') { if (plan.state !== 'awaiting_approval') return { exitCode: 1, stderr: `Plan is ${plan.state}, not awaiting_approval.\n` }; next = { ...plan, state: 'running', approvedAt: now, updatedAt: now }; }
  else if (action === 'cancel' || action === 'exit') { if (plan.state === 'done' || plan.state === 'cancelled') return { exitCode: 1, stderr: `Plan is already ${plan.state}.\n` }; next = { ...plan, state: 'cancelled', steps: plan.steps.map((step) => step.state === 'done' || step.state === 'failed' ? step : { ...step, state: 'cancelled' }), updatedAt: now, ...(action === 'exit' ? { exitReason: text(input.reason) || 'plan mode exited' } : {}) }; }
  else if (action === 'retry') { if (!['paused'].includes(plan.state)) return { exitCode: 1, stderr: `Plan is ${plan.state}; only paused plans can retry.\n` }; next = { ...plan, state: 'running', steps: plan.steps.map((step) => step.state === 'failed' ? { ...step, state: 'pending' } : step), updatedAt: now }; }
  else if (action === 'auto') { next = { ...plan, autoApprove: !plan.autoApprove, updatedAt: now }; }
  else return { exitCode: 1, stderr: `Unknown plan action: ${action}\n` };
  savePersistedPlan(next); const receiptId = await services.receipts.record(`plan-${action}`, { planId: next.id, previousState: plan.state, state: next.state }); return { exitCode: 0, stdout: `${JSON.stringify({ plan: next, receiptId }, null, 2)}\n`, result: { plan: next, receiptId } as unknown as Json };
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
