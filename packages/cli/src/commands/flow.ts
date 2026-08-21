import { defineCommand } from 'citty';

import { resolve } from 'node:path';

import {
  elaborateFlowFile, formatFlowError,
  type ElaboratedFlow, type FlowError,
} from '@kernlang/agon-flow-core';

import { header, success, fail, info, table, bold, dim } from '../blocks/output-format.js';

// ── agon flow ──────────────────────────────────────────────────────────────
// Slice 1 ships `validate` only: elaborate-then-execute means the whole graph
// is type-checked, subflow-resolved and route-checked BEFORE a single engine
// is dispatched. `agon flow run` lands with the runtime (slice 2).
//
// flow-core has no adapter/registry dependency at all, so validation provably
// cannot spend a subscription token.

function printErrors(errors: FlowError[]): void {
  fail(`${errors.length} error${errors.length === 1 ? '' : 's'}`);
  for (const error of errors) {
    process.stdout.write(`  ${formatFlowError(error)}\n`);
  }
}

function printFlow(flow: ElaboratedFlow, file: string): void {
  success(`${flow.name} v${flow.version} — valid`);
  info(dim(file));
  process.stdout.write('\n');

  const rows = flow.params.map((param) => [
    bold(param.key),
    param.type,
    param.required ? 'required' : 'optional',
    param.source,
    param.aliasOf ? dim(`alias of ${param.aliasOf}`) : (param.label ?? ''),
  ]);
  if (rows.length > 0) table(['Param', 'Type', '', 'Source', ''], rows);
  else info('no parameters');

  const stepRows = flow.steps.map((step) => [
    step.id,
    step.type,
    step.effect ? 'effect' : '',
    step.routeSet.length > 0
      ? step.routeSet.map((marker) => `${marker.stepId}:${marker.branch}`).join(', ')
      : '',
  ]);
  table(['Step', 'Type', '', 'Route'], stepRows);

  if (flow.outputs.length > 0) {
    table(
      ['Output', 'From', 'Type'],
      flow.outputs.map((output) => [output.name, `${output.stepId}.${output.port}`, output.type]),
    );
  }
  if (flow.effects.length > 0) {
    info(`touches the world: ${flow.effects.join(', ')}`);
  }
}

export const flowValidateCommand: any = defineCommand({
  meta: {
    name: 'validate',
    description: 'Type-check a .agon-flow.json (subflows, ports, routes) without dispatching anything',
  },
  args: {
    file: {
      type: 'positional',
      description: 'Path to the .agon-flow.json file',
      required: true,
    },
    json: {
      type: 'boolean',
      description: 'Emit the elaborated step-DAG (or the errors) as JSON',
    },
  },
  run({ args }) {
    const file = resolve(String(args.file));
    const result = elaborateFlowFile(file);

    if (args.json) {
      process.stdout.write(`${JSON.stringify(
        result.ok ? { ok: true, flow: result.flow } : { ok: false, errors: result.errors },
        null,
        2,
      )}\n`);
      // exitCode (not process.exit) — a hard exit can truncate a piped stdout
      // write that has not flushed yet, which is exactly how this command is
      // used: `agon flow validate --json … | jq`.
      if (!result.ok) process.exitCode = 1;
      return;
    }

    header('Flow validate');
    if (!result.ok) {
      info(dim(file));
      printErrors(result.errors);
      process.exitCode = 1;
      return;
    }
    printFlow(result.flow, file);
  },
});

export const flowCommand: any = defineCommand({
  meta: {
    name: 'flow',
    description: 'Agon Flow — author and run node graphs where every AI step is a node. `agon flow validate <file>` type-checks a flow (subflows, ports, exclusive routes) before a single engine is dispatched.',
  },
  subCommands: {
    validate: flowValidateCommand,
  },
});
