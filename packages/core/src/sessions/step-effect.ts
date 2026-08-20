import { isReadOnlyCommand } from '../tools/tool-permissions.js';

import { bashRanGate } from '../blocks/context-scanner.js';

export type ToolStepEffect = 'read' | 'verify' | 'mutate' | 'other';

export interface ToolStepEffectEntry {
  effect: ToolStepEffect;
  novel: boolean;
}

/**
 * Tools whose only effect is inspecting the workspace. RetrieveResult is deliberately absent: it re-fetches a cached tool result rather than grounding a path, so it stays `other` (neutral).
 */
export const READ_STEP_TOOLS: Set<string> = new Set(['read', 'grep', 'glob']);

/**
 * Project write-work tools, matching the cli isWriteToolName set (SaveMemory excluded — it writes durable memory, not the project tree).
 */
export const MUTATE_STEP_TOOLS: Set<string> = new Set(['edit', 'write', 'multiedit', 'notebookedit']);

/**
 * Max characters of the primary argument kept in a step signature. Bounds memory on a pathological argument while staying long enough to distinguish real calls.
 */
export const STEP_SIGNATURE_ARG_CAP: number = 500;

/**
 * Lowercase a tool name and strip the 'Agon' MCP alias prefix so AgonBash/Bash, AgonEdit/Edit classify identically on every path (native, XML, MCP).
 */
export function normalizeStepToolName(name: string): string {
  const raw = String(name ?? '').trim().toLowerCase();
  return raw.startsWith('agon') ? raw.slice(4) : raw;
}

/**
 * The identity-bearing argument of a tool call: the command for Bash, the file path PLUS the paged window (offset/limit) for Read, the pattern plus every scope argument (path/glob/type) for Grep/Glob, else the first present of command/file_path/path/pattern/id. Used for BOTH effect classification and the step signature so a repeat is recognized by what it touched, not by argument spelling. The Read window and the Grep scope args are part of the identity because they change WHAT the call returns: paging through a 4000-line file (offset 1 / 2001 / 4001) and grepping one pattern under two different globs are distinct steps, each of which brings new information — collapsing them onto one signature made every page after the first a read-REPEAT, so a legitimate paged read of a big file earned no budget and fed the read-spiral guard. The core loop's own seenReadKeys accumulator already keys on the full arg record for exactly this reason; this keeps the shared signature consistent with it. Flags that only reshape the SAME content (output_mode, -n, -A/-B/-C, head_limit) are deliberately excluded — re-running one query to reformat its output is a repeat.
 */
export function primaryStepInput(tool: string, args: Record<string,unknown>): string {
  const name = normalizeStepToolName(tool);
  const record = args ?? {};
  if (name === 'bash') {
    return String(record.command ?? '');
  }
  if (name === 'grep' || name === 'glob') {
    return [String(record.pattern ?? ''), String(record.path ?? ''), record.glob ? `glob=${String(record.glob)}` : '', record.type ? `type=${String(record.type)}` : ''].filter((part: string) => part.length > 0).join(' ');
  }
  const path = String(record.file_path ?? record.path ?? record.command ?? record.pattern ?? record.id ?? '');
  if (name !== 'read') {
    return path;
  }
  const window = [(record.offset === undefined || record.offset === null) ? '' : `offset=${String(record.offset)}`, (record.limit === undefined || record.limit === null) ? '' : `limit=${String(record.limit)}`].filter((part: string) => part.length > 0).join(' ');
  return (window.length > 0) ? `${path} ${window}` : path;
}

/**
 * Stable per-cycle identity of one tool call: normalized tool name + whitespace-collapsed primary argument, capped. Two calls with the same signature are the same step — the second is a repeat.
 */
export function normalizeStepSignature(tool: string, input: string): string {
  const arg = String(input ?? '').trim().replace(/[ \t\n\r\f\v]+/g, ' ').slice(0, STEP_SIGNATURE_ARG_CAP);
  return `${normalizeStepToolName(tool)}:${arg}`;
}

/**
 * Canonical per-cycle identity of one tool call, computed from its ARGS (never from a pre-stringified input) so every ledger — core earned-budget novelty, cli read-repeats, brain progress novelty — hashes the same shape. Uses the identity-bearing primary argument; when the tool has no recognized identity key (an orchestration/MCP tool with a free-form payload) it falls back to a sorted key=value rendering of the whole args record, so two genuinely different calls are never collapsed into one signature.
 */
export function canonicalStepSignature(tool: string, args: Record<string,unknown>): string {
  const record = args ?? {};
  const primary = primaryStepInput(tool, record);
  if (primary.length > 0) {
    return normalizeStepSignature(tool, primary);
  }
  const fallback = Object.keys(record).sort().map((key: string) => `${key}=${String(record[key] ?? '')}`).join(' ');
  return normalizeStepSignature(tool, fallback);
}

/**
 * Classify one executed tool call by EFFECT. Read/Grep/Glob are read; the write-work set is mutate; Bash is decided by its command — gate-matching (bashRanGate) is verify, otherwise read-only is read and anything else is other. Every other tool is other (neutral). Pure; gateMatchers may be omitted (no discovered gate → a gate command cannot be recognized and falls through to read/other).
 */
export function classifyToolEffect(tool: string, input: string, gateMatchers?: string[]): ToolStepEffect {
  const name = normalizeStepToolName(tool);
  if (MUTATE_STEP_TOOLS.has(name)) {
    return 'mutate';
  }
  if (READ_STEP_TOOLS.has(name)) {
    return 'read';
  }
  if (name !== 'bash') {
    return 'other';
  }
  const command = String(input ?? '').trim();
  if (!command) {
    return 'other';
  }
  if (bashRanGate(command, gateMatchers ?? [])) {
    return 'verify';
  }
  if (isReadOnlyCommand(command)) {
    return 'read';
  }
  return 'other';
}

/**
 * True for the one class that earns nothing: a read whose signature was already seen this cycle.
 */
export function isReadRepeat(effect: ToolStepEffect, novel: boolean): boolean {
  return effect === 'read' && !novel;
}

/**
 * Budget growth is EARNED, not granted for merely not failing. A step earns growth when at least one of its successful calls was a mutate, a verify, a NOVEL read, or an unclassifiable other. A step made only of read-repeats earns nothing, so a pure re-read spiral stays at the base budget instead of climbing to the cap. An empty step (no successful classified call) earns nothing.
 */
export function stepEarnsBudgetGrowth(entries: ToolStepEffectEntry[]): boolean {
  return (entries ?? []).some((entry: ToolStepEffectEntry) => !isReadRepeat(entry.effect, entry.novel));
}
