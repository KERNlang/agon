import { commandResultToToolResult } from '@kernlang/agon-mod-api';
import type { AgonModFactory, Dispose, InvocationContext, Json, Registrar } from '@kernlang/agon-mod-api';
import { JOB_TOOLS, buildMcpJobCommand } from './mcp-contract.js';
import { ModularJobService } from './persisted-job-service.js';
import { runSessionJobContribution } from './session-jobs.js';
import { runJobCliContribution } from './cli-invocation.js';
import { jobCliProjection } from './cli-projection.js';
import type { JobCliAction } from './cli-projection.js';
export { ModularJobService };
export type { JobState, JobSnapshot } from './job-service.js';
export type JobEvent = import('./job-service.js').JobEvent<Json>;
export type JobOutcome = import('./job-service.js').JobOutcome<Json>;
export type JobTaskContext = import('./job-service.js').JobTaskContext<Json>;

const schema = Object.freeze({ type: 'object', additionalProperties: true, properties: { jobId: { type: 'string' }, kind: { type: 'string' }, label: { type: 'string' }, prompt: { type: 'string' }, engine: { type: 'string' }, after: { type: 'number' }, limit: { type: 'number' }, reason: { type: 'string' }, _: { type: 'array', items: { type: 'string' } } } }) as Readonly<Record<string, Json>>;
const actions: Record<string, string> = { 'cliCommands:0015': 'daemon', 'cliCommands:0026': 'parent', 'cliCommands:0027': 'cancel', 'cliCommands:0028': 'events', 'cliCommands:0029': 'list', 'cliCommands:0030': 'result', 'cliCommands:0031': 'status', 'cliCommands:0032': 'submit', 'mcpTools:0010': 'cancel', 'mcpTools:0011': 'events', 'mcpTools:0012': 'list', 'mcpTools:0013': 'result', 'mcpTools:0014': 'status', 'mcpTools:0015': 'submit', 'intentVariants:0031': 'focus', 'intentVariants:0038': 'list', 'builtinCommandMetadata:0024': 'focus', 'builtinCommandMetadata:0029': 'list', 'tuiSlashCommands:0032': 'focus', 'tuiSlashCommands:0040': 'list' };
export const createMod: AgonModFactory = services => {
  return Object.freeze({
    apiVersion: '1' as const,
    async activate(registrar: Registrar): Promise<Dispose> {
      const disposers: Dispose[] = [];
      const lifetime = new AbortController();
      let active = true;
      const dispose = async () => {
        active = false;
        lifetime.abort(new Error('Jobs service is closed'));
        const failures: unknown[] = [];
        for (const dispose of [...disposers].reverse()) {
          try { await dispose(); } catch (error) { failures.push(error); }
        }
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) throw new AggregateError(failures, 'Jobs shutdown failed; all registrations received cleanup attempts');
      };
      try {
        for (const [id, action] of Object.entries(actions)) {
          const run = async (input: Json, context: InvocationContext) => {
            if (!active) throw new Error('Jobs service is closed');
            return id.startsWith('cliCommands:')
              ? runJobCliContribution(action as JobCliAction | 'parent' | 'daemon', input, { ...context, signal: AbortSignal.any([context.signal, lifetime.signal]) }, () => { if (!active) throw new Error('Jobs service is closed'); })
              : runSessionJobContribution(action === 'focus' ? 'focus' : 'list', input, context);
          };
          if (id.startsWith('mcpTools:')) {
            const tool = JOB_TOOLS.find(candidate => candidate.name === `Job${action[0].toUpperCase()}${action.slice(1)}`);
            if (!tool) throw new Error(`No Jobs contract for ${id}`);
            disposers.push(registrar.tool('mcp', {
              id, description: tool.description, inputSchema: tool.inputSchema,
              effect: ['list', 'status', 'events', 'result'].includes(action) ? 'read' : 'process',
              async run(input, context) {
                try {
                  if (!active) throw new Error('Jobs service is closed');
                  context.signal.throwIfAborted();
                  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Job input must be an object');
                  buildMcpJobCommand(tool.name, input);
                  if (!services.jobs) throw new Error('Jobs daemon transport is unavailable in this host');
                  const output = await services.jobs.runTool(tool.name, input, context);
                  if (!active) throw new Error('Jobs service is closed');
                  context.signal.throwIfAborted();
                  let parsed: unknown;
                  try { parsed = JSON.parse(output); } catch { /* Events use JSON lines. */ }
                  if (parsed && typeof parsed === 'object' && 'ok' in parsed && parsed.ok === false) {
                    throw new Error('error' in parsed ? String(parsed.error) : 'Jobs daemon request failed');
                  }
                  return output;
                } catch (error) {
                  return commandResultToToolResult({
                    exitCode: 1,
                    stderr: error instanceof Error ? error.message : String(error),
                  });
                }
              },
            }));
          } else if (id.startsWith('intentVariants:')) {
            disposers.push(registrar.intent({
              id, description: `${action} a background job`, inputSchema: schema,
              parse(value) {
                const parts = value.trim().split(/\s+/);
                if (action === 'list' && parts[0]?.toLowerCase() === '/jobs') {
                  const requested = parts[1]?.toLowerCase();
                  return { action: requested === 'cancel' ? 'cancel' : 'list', jobId: requested === 'cancel' ? parts[2] : undefined };
                }
                if (action === 'focus' && parts[0]?.toLowerCase() === '/focus') return { jobId: parts.slice(1).join(' ') || undefined };
                return undefined;
              },
              run,
            }));
          } else {
            disposers.push(registrar.command(id.startsWith('cliCommands:') ? 'cli' : 'tui', {
              id, description: `${action} a bounded background job`, inputSchema: schema, run,
              ...(id.startsWith('cliCommands:') ? jobCliProjection(action as JobCliAction | 'parent' | 'daemon') : {}),
            }));
          }
        }
        for (const id of ['resultAndEnvelopeTypes:0040', 'resultAndEnvelopeTypes:0071', 'resultAndEnvelopeTypes:0072', 'resultAndEnvelopeTypes:0073']) {
          disposers.push(registrar.resultType({
            id, schema, readableVersions: '>=0.2.0',
            render: async payload => ({ text: JSON.stringify(payload, null, 2) }),
          }));
        }
      } catch (error) {
        try { await dispose(); }
        catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Jobs activation and cleanup failed'); }
        throw error;
      }
      return dispose;
    },
  });
};
export default createMod;
