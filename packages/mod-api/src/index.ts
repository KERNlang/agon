export { AGON_MOD_API_VERSION } from './version.js';
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
  run(input: Json, context: InvocationContext): InvocationOutput;
}

export interface IntentContribution {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, Json>>;
  parse(input: string): Awaitable<Json | undefined>;
  run(input: Json, context: InvocationContext): InvocationOutput;
}

export interface ToolContribution {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, Json>>;
  readonly effect: 'read' | 'write' | 'network' | 'process';
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

export interface ModServices {
  readonly identity: ModIdentity;
  readonly source: ModSource;
  readonly logger: {
    debug(message: string, fields?: Json): void;
    info(message: string, fields?: Json): void;
    warn(message: string, fields?: Json): void;
  };
  readonly receipts: { record(kind: string, payload: Json): Awaitable<string> };
  readonly permissions: { check(capability: string, resource?: string): Awaitable<PermissionDecision> };
  readonly state: {
    read<T extends Json>(key: string): Awaitable<T | undefined>;
    write(key: string, value: Json): Awaitable<void>;
  };
  readonly engines: { dispatch(engineId: string, prompt: string, context: InvocationContext): Awaitable<Json> };
}

export interface AgonModV1 {
  readonly apiVersion: '1';
  activate(registrar: Registrar, services: ModServices): Awaitable<Dispose | void>;
}

export type AgonModFactory = (services: ModServices) => Awaitable<AgonModV1>;
