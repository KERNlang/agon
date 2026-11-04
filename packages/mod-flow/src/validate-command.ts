import { resolve } from 'node:path';
import type { CommandResult, InvocationContext, Json } from '@kernlang/agon-mod-api';
import { elaborateFlowFile, formatFlowError, type ElaboratedFlow } from './core/index.js';

export const validateSchema = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: ['file'],
  properties: {
    file: { type: 'string', description: 'Path to the .agon-flow.json file' },
    json: { type: 'boolean', description: 'Emit the elaborated step-DAG (or the errors) as JSON' },
  },
}) as unknown as Readonly<Record<string, Json>>;

export const FLOW_USAGE = 'Usage: agon flow validate <file> [--json]\n';

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string {
  const widths = headers.map((header, column) => Math.max(header.length, ...rows.map(row => (row[column] ?? '').length)));
  const line = (cells: readonly string[]) => cells.map((cell, column) => cell.padEnd(widths[column])).join('  ').trimEnd();
  return [line(headers), ...rows.map(line)].join('\n') + '\n';
}

function renderFlow(flow: ElaboratedFlow, file: string): string {
  const sections = [`${flow.name} v${flow.version}: valid\n${file}\n`];
  sections.push(flow.params.length
    ? table(['Param', 'Type', 'Required', 'Source', 'Note'], flow.params.map(param => [
      param.key,
      param.type,
      param.required ? 'required' : 'optional',
      param.source,
      param.aliasOf ? `alias of ${param.aliasOf}` : (param.label ?? ''),
    ]))
    : 'no parameters\n');
  sections.push(table(['Step', 'Type', 'Effect', 'Route'], flow.steps.map(step => [
    step.id,
    step.type,
    step.effect ? 'effect' : '',
    step.routeSet.map(marker => `${marker.stepId}:${marker.branch}`).join(', '),
  ])));
  if (flow.outputs.length) {
    sections.push(table(['Output', 'From', 'Type'], flow.outputs.map(output => [output.name, `${output.stepId}.${output.port}`, output.type])));
  }
  if (flow.effects.length) sections.push(`touches the world: ${flow.effects.join(', ')}\n`);
  return sections.join('\n');
}

export function runFlowValidate(input: Json, context: InvocationContext): CommandResult {
  const args = input as { file: string; json?: boolean };
  const file = resolve(context.cwd, args.file);
  const result = elaborateFlowFile(file);
  if (args.json) {
    const payload = result.ok ? { ok: true, flow: result.flow } : { ok: false, errors: result.errors };
    return { exitCode: result.ok ? 0 : 1, stdout: `${JSON.stringify(payload, null, 2)}\n` };
  }
  if (result.ok) return { exitCode: 0, stdout: renderFlow(result.flow, file) };
  const count = `${result.errors.length} error${result.errors.length === 1 ? '' : 's'}`;
  return { exitCode: 1, stdout: `${file}\n${count}\n${result.errors.map(error => `  ${formatFlowError(error)}\n`).join('')}` };
}
