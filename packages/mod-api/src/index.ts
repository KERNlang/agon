export {
  AppliedProfileSnapshotSchema, DesiredStateSchema, ProfileDefinitionSchema,
  validateDesiredState, validateProfileDefinition,
} from './state.js';
export type {
  AppliedProfileSnapshotDocument, DesiredStateDocument, ProfileDefinitionDocument,
} from './state.js';
export {
  JobEnvelopeSchema, PersistedEnvelopeSchema, PlanEnvelopeSchema, ResultEnvelopeSchema,
  SessionEnvelopeSchema, validatePersistedEnvelope,
} from './envelopes.js';
export type { JobEnvelope, PersistedEnvelope, PlanEnvelope, ResultEnvelope, SessionEnvelope } from './envelopes.js';

export { AGON_MOD_API_VERSION } from './version.js';
export { CommandExecutionError, commandResultToToolResult } from './command-tool-result.js';
export {
  CONTENT_HASH_PATTERN,
  ManifestSchema,
  ManifestValidationError,
  MOD_ID_PATTERN,
  RELATIVE_PACKAGE_PATH_PATTERN,
  validateManifest,
} from './manifest.js';
export type {
  ManifestContributionKind,
  ModManifest,
  ModPackageClass,
  ModPlatform,
} from './manifest.js';

export type Awaitable<T> = T | Promise<T>;
export type Dispose = () => Awaitable<void>;
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Platform = 'darwin-arm64' | 'darwin-x64' | 'linux-arm64' | 'linux-x64';
export type ModSource = 'bundled' | 'registry' | 'user-folder' | 'explicit-dev';
export type PermissionDecision = 'allow' | 'ask' | 'deny';

export interface ModIdentity {
  readonly id: string;
  readonly version: string;
  readonly contentHash: `sha256:${string}`;
}

export interface InvocationContext {
  readonly invocationId: string;
  readonly sessionId?: string;
  readonly cwd: string;
  readonly platform: Platform;
  readonly signal: AbortSignal;
  readonly config: Readonly<Record<string, Json>>;
  /** Recheck host authority after an asynchronous operation, before an effect. */
  readonly assertCurrent?: () => void;
  /** Refresh this invocation's read-before-write cache after a file write. */
  readonly didWriteFile?: (path: string, content: string) => Awaitable<void>;
}

export interface CommandResult {
  readonly exitCode: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly result?: Json;
  readonly failure?: {
    readonly code: string;
    readonly message: string;
    readonly retryable: boolean;
    readonly details?: Json;
  };
}

export type OutputEvent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'progress'; readonly message: string; readonly completed?: number; readonly total?: number }
  | { readonly type: 'artifact'; readonly artifactId: string; readonly mediaType: string }
  | { readonly type: 'result'; readonly result: CommandResult };

export type InvocationOutput = Awaitable<CommandResult | AsyncIterable<OutputEvent>>;

export interface CommandContribution {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly inputSchema?: Readonly<Record<string, Json>>;
  readonly cli?: {
    readonly positionals?: readonly string[];
    readonly descriptions?: Readonly<Record<string, string>>;
    readonly aliases?: Readonly<Record<string, string>>;
  };
  parse?(input: string): Awaitable<Json | Readonly<Record<string, Json | undefined>> | undefined>;
  run(input: Json, context: InvocationContext): InvocationOutput;
}

export interface IntentContribution {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, Json>>;
  parse(input: string): Awaitable<Json | Readonly<Record<string, Json | undefined>> | undefined>;
  run(input: Json, context: InvocationContext): InvocationOutput;
}

export interface ToolContribution {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, Json>>;
  readonly effect: 'read' | 'write' | 'network' | 'process';
  /** The host must obtain approval for each call before running this tool. */
  readonly requiresConfirmation?: boolean;
  readonly metadata?: Json;
  run(input: Json, context: InvocationContext): Awaitable<Json>;
}

export interface LifecycleContribution {
  readonly event: string;
  readonly aliases?: readonly string[];
  readonly priority?: number;
  handle(payload: Json, context: InvocationContext): Awaitable<void>;
}

export interface PlanStepContribution {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly inputSchema: Readonly<Record<string, Json>>;
  readonly resultSchema: Readonly<Record<string, Json>>;
  readonly risk: 'read' | 'workspace-write' | 'external-write' | 'destructive';
  run(input: Json, context: InvocationContext): InvocationOutput;
}

export interface ResultContribution {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly schema: Readonly<Record<string, Json>>;
  readonly readableVersions: string;
  render(payload: Json): Awaitable<{ readonly text: string; readonly markdown?: string }>;
}

export interface DocsContribution {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly title: string;
  readonly markdown: string;
}

export interface Registrar {
  command(surface: 'cli' | 'tui', contribution: CommandContribution): Dispose;
  intent(contribution: IntentContribution): Dispose;
  tool(surface: 'mcp' | 'cesar', contribution: ToolContribution): Dispose;
  planStep(contribution: PlanStepContribution): Dispose;
  lifecycle(contribution: LifecycleContribution): Dispose;
  resultType(contribution: ResultContribution): Dispose;
  docs(contribution: DocsContribution): Dispose;
  config(namespace: string, schema: Readonly<Record<string, Json>>, aliases?: readonly string[]): Dispose;
}

export interface EngineDispatchOptions {
  readonly timeoutSeconds?: number;
  readonly systemPrompt?: string;
  /** Forward the adapter's text-only control. This is not a process sandbox. */
  readonly textOnly?: boolean;
  readonly mode?: 'exec' | 'review' | 'agent';
}

/** Host-owned browser runtime. The browser mod owns the command surface while
 * the host supplies the opened agent brain and ledger/job infrastructure. */
export interface BrowserServeOptions {
  readonly port?: number;
  readonly engineId?: string;
  readonly allowedOrigins: readonly string[];
}

export interface BrowserServeHandle {
  readonly url: string;
  readonly token: string;
  readonly sessionId: string;
  readonly engineId: string;
  readonly allowedOrigins: readonly string[];
  readonly connectionFile: string;
  stop(): Awaitable<void>;
}

export interface BrowserHostServices {
  startServe(options: BrowserServeOptions, context: InvocationContext): Awaitable<BrowserServeHandle>;
  runCommand(
    action: 'chrome' | 'drive' | 'extension-install' | 'extension-native-host' | 'host-install' | 'host-uninstall' | 'host-status' | 'host-stop',
    input: Json,
    context: InvocationContext,
  ): Awaitable<CommandResult>;
}

/** Host-owned process grounding. The Workspaces contribution owns bookmark
 * state and selection; the host applies the selected path to the current
 * interactive process so subsequent tools and engines use the new cwd. */
export interface WorkspaceHostServices {
  setSessionRoot(path: string, context: InvocationContext): Awaitable<void>;
}

/** Typed interactive requests; Plan owns policy and the host supplies UI effects. */
export type PlanSessionRequest =
  | { readonly type: 'plan-task'; readonly task: string }
  | { readonly type: 'plan' | 'plan-resume'; readonly planId?: string }
  | { readonly type: 'plans' | 'approve' | 'retry' | 'cancel' }
  | { readonly type: 'auto'; readonly input: string; readonly autoMode: true };

/** Invocation-scoped interactive coordination; never selects a persisted plan implicitly. */
export interface PlanSessionHostServices {
  run(request: PlanSessionRequest, context: InvocationContext): Awaitable<CommandResult>;
}

export interface PatchApplicationInteraction {
  /** Ordered per-step snapshots, not a mutable Plan or UI context. */
  readonly artifacts: readonly (readonly { readonly type: string; readonly path: string }[])[];
  notify(level: 'info' | 'warning' | 'error' | 'success', message: string): void;
  preview(patch: { readonly engineId: string; readonly content: string }): void;
  confirm(cwd: string): Awaitable<string>;
  /** Recheck cancellation, session lifetime, and generation before effects. */
  assertActive(): void;
}

/** UI capabilities only. The Forge mod owns selection, preflight and Git apply.
 * Opening an interaction does not grant approval or permission to write. */
export interface PatchApplicationHostServices {
  open(context: InvocationContext): Awaitable<PatchApplicationInteraction | undefined>;
}

export interface RunRecordHandle {
  readonly id: string;
  readonly path: string;
  readonly mode: string;
  readonly startedAt: string;
}

/** Host-owned durable run directories. Workflow mods supply semantic status;
 * the host owns filesystem layout and compatibility with historical readers. */
export interface RunRecordHostServices {
  start(mode: string, label: string | undefined, context: InvocationContext): Awaitable<RunRecordHandle>;
  finish(handle: RunRecordHandle, status: Json, context: InvocationContext): Awaitable<void>;
  writeArtifact(handle: RunRecordHandle, relativePath: string, content: string, context: InvocationContext): Awaitable<void>;
}

export type JobToolName = 'JobSubmit' | 'JobList' | 'JobStatus' | 'JobEvents' | 'JobResult' | 'JobCancel';

/** Transport to the existing daemon. The Jobs mod owns the tool contract. */
export interface JobsHostServices {
  runTool(name: JobToolName, input: Readonly<Record<string, Json>>, context: InvocationContext): Awaitable<string>;
}

export type EngineRatingScope = 'forge' | 'brainstorm' | 'tribunal' | 'critique';
export interface RankedEngine {
  readonly engineId: string;
  readonly reason: 'top-rated' | 'random' | 'none';
  readonly scope: EngineRatingScope | 'global' | null;
}

export interface ModServices {
  readonly identity: ModIdentity;
  readonly source: ModSource;
  readonly logger: {
    debug(message: string, fields?: Json): Awaitable<void>;
    info(message: string, fields?: Json): Awaitable<void>;
    warn(message: string, fields?: Json): Awaitable<void>;
  };
  readonly receipts: { record(kind: string, payload: Json): Awaitable<string> };
  readonly permissions: { check(capability: string, resource?: string): Awaitable<PermissionDecision> };
  readonly state: {
    read<T extends Json>(key: string): Awaitable<T | undefined>;
    write(key: string, value: Json): Awaitable<void>;
  };
  readonly engines: {
    dispatch(engineId: string, prompt: string, context: InvocationContext, options?: EngineDispatchOptions): Awaitable<Json>;
    listActive?(context: InvocationContext): Awaitable<readonly string[]>;
    /** Resolve explicit IDs and aliases. Reject removed or unavailable engines. */
    resolveRequested?(engineIds: readonly string[], context: InvocationContext): Awaitable<readonly string[]>;
    rank?(engineIds: readonly string[], scopes: readonly EngineRatingScope[], context: InvocationContext): Awaitable<readonly RankedEngine[]>;
  };
  /** Present only for trusted bundled browser integration. Folder mods never receive it. */
  readonly browser?: BrowserHostServices;
  readonly patchApplication?: PatchApplicationHostServices;
  readonly planSession?: PlanSessionHostServices;
  /** Present only for the bundled workspaces integration. Folder mods never receive it. */
  readonly workspace?: WorkspaceHostServices;
  /** Present only for bundled workflows that participate in the legacy run ledger. */
  readonly runs?: RunRecordHostServices;
  /** Bundled Jobs transport only. It does not grant arbitrary process execution. */
  readonly jobs?: JobsHostServices;
  /** Bundled ratings maintenance: all registered IDs plus configured keep IDs. */
  readonly ratings?: {
    protectedEngineIds(context: InvocationContext): Awaitable<readonly string[]>;
  };
}

export interface AgonModV1 {
  readonly apiVersion: '1';
  activate(registrar: Registrar, services: ModServices): Awaitable<Dispose | void>;
}

export type AgonModFactory = (services: ModServices) => Awaitable<AgonModV1>;
