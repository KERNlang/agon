/**
 * Zod schemas for engine configuration validation.
 * External library binding — stays TypeScript per CLAUDE.md.
 *
 * Validates engine/*.json configs at load time, killing silent failures.
 * Schema mirrors EngineDefinition from types.kern.
 */
import { z } from 'zod';

export const EngineModeConfigSchema = z.object({
  args: z.array(z.string()),
  stdin: z.boolean().optional(),
});

export const EngineModelConfigSchema = z.object({
  configKey: z.string().optional(),
  flag: z.string().optional(),
  default: z.union([z.string(), z.null()]).optional(),
});

export const EngineEffortConfigSchema = z.object({
  flag: z.string().min(1).optional(),
  configKey: z.string().min(1).optional(),
  levels: z.array(z.string().min(1)).min(1),
  default: z.string().min(1).optional(),
}).refine(
  (effort) => effort.default === undefined || effort.levels.includes(effort.default),
  { message: 'default must be one of the declared effort levels', path: ['default'] },
).refine(
  (effort) => effort.flag !== undefined || effort.configKey !== undefined,
  { message: 'effort requires either flag or configKey', path: ['flag'] },
);

export const CliModelEntrySchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
});

export const EngineCliModelConfigSchema = z.object({
  default: z.string().min(1).optional(),
  list: z.array(CliModelEntrySchema).min(1).optional(),
  dynamicListCmd: z.array(z.string()).min(1).refine(
    (command) => command.every((part) => part.trim().length > 0),
    { message: 'dynamicListCmd entries must be non-empty' },
  ).optional(),
}).refine(
  (models) => models.list !== undefined || models.dynamicListCmd !== undefined,
  { message: 'cliModels requires a static list or dynamicListCmd', path: ['list'] },
).refine(
  (models) => models.default === undefined
    || models.list === undefined
    || models.dynamicListCmd !== undefined
    || models.list.some((entry) => entry.id === models.default),
  { message: 'default must identify an entry in the static model list', path: ['default'] },
);

export const EngineEnvVarSchema = z.object({
  required: z.boolean().optional(),
  default: z.string().optional(),
});

export const CompanionConfigSchema = z.object({
  protocol: z.enum(['jsonrpc', 'acp', 'structured-cli', 'stream-json']),
  serverCmd: z.array(z.string()),
  // Flag the companion server uses to set its working dir (e.g. opencode `--cwd`).
  // companionDispatch appends [cwdArg, opts.cwd] so the server is pinned to the
  // worktree — required for servers that ignore the spawn cwd (otherwise their
  // writes leak into the launch repo).
  cwdArg: z.string().optional(),
  sandbox: z.enum(['read-only', 'workspace-write', 'danger-full-access']).optional(),
  features: z.object({
    threadResume: z.boolean().optional(),
    nativeReview: z.boolean().optional(),
    structuredOutput: z.boolean().optional(),
  }).optional(),
});

export const ApiConfigSchema = z.object({
  baseUrl: z.string().url(),
  apiKeyEnv: z.string().min(1),
  model: z.string().min(1),
  maxTokens: z.number().int().positive().optional(),
  contextWindow: z.number().int().positive().optional(),
  format: z.enum(['openai', 'anthropic']).optional(),
  firstChunkTimeoutMs: z.number().int().positive().optional(),
  idleTimeoutMs: z.number().int().positive().optional(),
  firstChunkRetryCount: z.number().int().nonnegative().optional(),
  firstChunkRetryBackoffMs: z.number().int().nonnegative().optional(),
});

// Workspace-pure isolation knobs. MUST be modelled here or Zod silently strips
// it at load (z.object drops unknown keys), leaving every registry-loaded engine
// with isolationHints=undefined — which makes computeEngineIsolation fall back to
// inherit and isolation never actually happens. Mirrors EngineDefinition.isolationHints
// in types.kern.
// authFiles/authMarker are joined into filesystem paths (seed copy + the auth
// gate's existsSync). Engine configs are normally trusted builtins, but user/
// plugin-provided configs aren't — reject path traversal at load so a config
// can't read outside the real config home or have its marker resolve to the dir
// itself. (basename() at the use-sites is the runtime backstop; this surfaces
// the misconfig loudly at load.)
const RelAuthFile = z
  .string()
  .refine(
    (v) => v.length > 0
      && !v.startsWith('/')
      && !v.startsWith('\\')
      && !/^[A-Za-z]:/.test(v)
      && !/(^|[\\/])\.\.([\\/]|$)/.test(v),
    { message: 'authFiles entries must be non-empty relative paths without absolute or ".." segments' },
  );
const AuthMarker = z
  .string()
  .refine(
    (v) => v.length > 0 && !/[\\/:]/.test(v) && v !== '.' && v !== '..',
    { message: 'authMarker must be a non-empty bare filename (no path separators, drive prefix, ".", or "..")' },
  );

export const IsolationHintsSchema = z.object({
  configEnv: z.string().optional(),
  strictMcpArgs: z.array(z.string()).optional(),
  personalPaths: z.array(z.string()).optional(),
  authFiles: z.array(RelAuthFile).optional(),
  authMarker: AuthMarker.optional(),
  setupHint: z.string().optional(),
  loginArgs: z.array(z.string()).optional(),
  supportsProjectMcp: z.boolean().optional(),
});

// Proactive context-window budget. MUST be modelled here or Zod silently strips
// it at load (z.object drops unknown keys), leaving every registry-loaded engine
// with sessionBudget=undefined — which makes the pre-turn gate inert. Mirrors
// EngineDefinition.sessionBudget / SessionBudget in types.kern. Thresholds are
// fractions of the effective window; bounds reject inverted/out-of-range configs
// loudly at load instead of silently mis-gating.
const ThresholdFraction = z.number().gt(0).lte(1);
export const SessionBudgetSchema = z.object({
  contextWindow: z.number().int().positive(),
  reserveTokens: z.number().int().nonnegative().optional(),
  warnAt: ThresholdFraction.optional(),
  compactAt: ThresholdFraction.optional(),
  hardStopAt: ThresholdFraction.optional(),
  estimator: z.enum(['chars-per-token', 'message-history']).optional(),
  charsPerToken: z.number().positive().optional(),
}).refine(
  (b) => b.reserveTokens === undefined || b.reserveTokens < b.contextWindow,
  { message: 'reserveTokens must be less than contextWindow (otherwise the effective window is degenerate)', path: ['reserveTokens'] },
);

export const EngineDefinitionSchema = z.object({
  schemaVersion: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  id: z.string().min(1),
  displayName: z.string().min(1),
  binary: z.string().optional(),
  searchPaths: z.array(z.string()).optional(),
  versionCmd: z.array(z.string()).optional(),
  isLocal: z.boolean(),
  tier: z.enum(['builtin', 'user']),
  installHint: z.string().optional(),
  timeout: z.number().int().positive(),
  exec: EngineModeConfigSchema.optional(),
  review: EngineModeConfigSchema.optional(),
  agent: EngineModeConfigSchema.optional(),
  model: EngineModelConfigSchema.optional(),
  effort: EngineEffortConfigSchema.optional(),
  env: z.record(z.string(), EngineEnvVarSchema).optional(),
  test: z.object({ args: z.array(z.string()) }).optional(),
  modes: z.array(z.enum(['exec', 'review', 'agent'])).optional(),
  modelConfigKey: z.string().optional(),
  adapterType: z.string().optional(),
  family: z.string().min(1).optional(),
  derivedFrom: z.string().min(1).optional(),
  capabilities: z.array(z.string()).optional(),
  // Guard-pipeline mode (P1+P2). Optional enum mirroring EngineDefinition.guards
  // in types.kern. MUST be modelled here or Zod silently strips it at load
  // (z.object drops unknown keys), leaving every registry-loaded engine with
  // guards=undefined → resolveGuardMode falls back to 'strict' and the new
  // pipeline never activates from an engine config.
  guards: z.enum(['strict', 'invariants', 'shadow']).optional(),
  imageFlag: z.string().optional(),
  systemPromptFlag: z.string().optional(),
  api: ApiConfigSchema.optional(),
  companion: CompanionConfigSchema.optional(),
  isolationHints: IsolationHintsSchema.optional(),
  sessionBudget: SessionBudgetSchema.optional(),
  cliModels: EngineCliModelConfigSchema.optional(),
});

export type ValidatedEngineDefinition = z.infer<typeof EngineDefinitionSchema>;

/**
 * Validate an engine config, returning the parsed result or a descriptive error.
 * Used by EngineRegistry.loadDir() to replace silent JSON.parse failures.
 */
export function validateEngineConfig(
  raw: unknown,
  filename: string,
): { ok: true; data: ValidatedEngineDefinition } | { ok: false; error: string } {
  const result = EngineDefinitionSchema.safeParse(raw);
  if (result.success) {
    return { ok: true, data: result.data };
  }
  const issues = result.error.issues
    .map((i) => `  ${i.path.join('.')}: ${i.message}`)
    .join('\n');
  return { ok: false, error: `Invalid engine config ${filename}:\n${issues}` };
}

/**
 * Validate all engine configs in a directory.
 * Returns valid engines and a list of errors for invalid ones.
 */
export function validateEngineDir(
  configs: Array<{ filename: string; raw: unknown }>,
): { valid: ValidatedEngineDefinition[]; errors: string[] } {
  const valid: ValidatedEngineDefinition[] = [];
  const errors: string[] = [];
  for (const { filename, raw } of configs) {
    const result = validateEngineConfig(raw, filename);
    if (result.ok) {
      valid.push(result.data);
    } else {
      errors.push(result.error);
    }
  }
  return { valid, errors };
}
