import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.jobs",
  "name": "Jobs",
  "version": "0.0.0-slice.5",
  "apiRange": ">=1.0.0 <2",
  "execution": "executable",
  "compatibility": {
    "kernelRange": ">=0.0.0-0 <2",
    "nodeRange": ">=22"
  },
  "packageClass": "user-toggleable-mod-package",
  "entrypoints": {
    "runtime": "dist/index.js",
    "types": "dist/index.d.ts"
  },
  "display": {
    "group": "Collaborate and automate",
    "order": 501
  },
  "dependencies": {
    "required": [
      {
        "id": "agon.api",
        "range": ">=0.0.0-0"
      },
      {
        "id": "agon.engine-runtime",
        "range": ">=0.0.0-0"
      },
      {
        "id": "agon.persistence",
        "range": ">=0.0.0-0"
      }
    ],
    "optional": [],
    "conflicts": []
  },
  "permissions": [],
  "platforms": [
    "darwin-arm64",
    "darwin-x64",
    "linux-arm64",
    "linux-x64"
  ],
  "assets": [
    {
      "path": "ownership.json",
      "kind": "documentation",
      "mediaType": "application/json",
      "contentHash": "sha256:6f6e342f13cb7626685a466e5b8cb1abf196e57f90ac870723fcaa5a7c785fd2",
      "bytes": 7523,
      "executable": false,
      "platforms": [
        "darwin-arm64",
        "darwin-x64",
        "linux-arm64",
        "linux-x64"
      ]
    },
    {
      "path": "schemas/config.schema.json",
      "kind": "schema",
      "mediaType": "application/schema+json",
      "contentHash": "sha256:e63646157031c3e9c8cb4ebfa563b1c57988b5b1e7c16aeb821c870e6aae3e04",
      "bytes": 214,
      "executable": false,
      "platforms": [
        "darwin-arm64",
        "darwin-x64",
        "linux-arm64",
        "linux-x64"
      ]
    }
  ],
  "contributes": {
    "cliCommands": [
      {
        "id": "cliCommands:0015",
        "aliases": []
      },
      {
        "id": "cliCommands:0026",
        "aliases": []
      },
      {
        "id": "cliCommands:0027",
        "aliases": []
      },
      {
        "id": "cliCommands:0028",
        "aliases": []
      },
      {
        "id": "cliCommands:0029",
        "aliases": []
      },
      {
        "id": "cliCommands:0030",
        "aliases": []
      },
      {
        "id": "cliCommands:0031",
        "aliases": []
      },
      {
        "id": "cliCommands:0032",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0031",
        "aliases": []
      },
      {
        "id": "intentVariants:0038",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0024",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0029",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0032",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0040",
        "aliases": []
      }
    ],
    "mcpTools": [
      {
        "id": "mcpTools:0010",
        "aliases": []
      },
      {
        "id": "mcpTools:0011",
        "aliases": []
      },
      {
        "id": "mcpTools:0012",
        "aliases": []
      },
      {
        "id": "mcpTools:0013",
        "aliases": []
      },
      {
        "id": "mcpTools:0014",
        "aliases": []
      },
      {
        "id": "mcpTools:0015",
        "aliases": []
      }
    ],
    "cesarTools": [],
    "lifecycleHooks": [],
    "resultTypes": [
      {
        "id": "resultAndEnvelopeTypes:0040",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0071",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0072",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0073",
        "aliases": []
      }
    ],
    "configKeys": [],
    "generatedDocs": []
  },
  "pack": {
    "include": [
      "agon.mod.json",
      "dist/index.js",
      "dist/index.d.ts",
      "ownership.json",
      "schemas/config.schema.json"
    ],
    "executable": []
  }
});
export const SOURCE_OCCURRENCES = Object.freeze([
  {
    "category": "builtinCommandMetadata",
    "id": "focus",
    "source": "packages/core/src/blocks/builtin-commands.ts:61",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "jobs",
    "source": "packages/core/src/blocks/builtin-commands.ts:60",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "daemon",
    "source": "packages/cli/src/lazy-commands.ts:325",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "job",
    "source": "packages/cli/src/lazy-commands.ts:310",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "job cancel",
    "source": "packages/cli/src/commands/job.ts:313",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "job events",
    "source": "packages/cli/src/commands/job.ts:284",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "job list",
    "source": "packages/cli/src/commands/job.ts:258",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "job result",
    "source": "packages/cli/src/commands/job.ts:300",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "job status",
    "source": "packages/cli/src/commands/job.ts:271",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "job submit",
    "source": "packages/cli/src/commands/job.ts:229",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "emittedEvents",
    "id": "command-finished",
    "source": "packages/cli/src/jobs/workflow-job.ts:151",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "semantic-source-rule"
  },
  {
    "category": "emittedEvents",
    "id": "command-started",
    "source": "packages/cli/src/jobs/workflow-job.ts:168",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "semantic-source-rule"
  },
  {
    "category": "emittedEvents",
    "id": "stdout",
    "source": "packages/cli/src/jobs/workflow-job.ts:205",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "semantic-source-rule"
  },
  {
    "category": "emittedEvents",
    "id": "submitted",
    "source": "packages/cli/src/jobs/daemon-job-router.ts:26",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "semantic-source-rule"
  },
  {
    "category": "intentVariants",
    "id": "focus",
    "source": "packages/cli/src/signals/intent-types.ts:49",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "jobs",
    "source": "packages/cli/src/signals/intent-types.ts:48",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "JobCancel",
    "source": "packages/mcp/src/job-tools.ts:13",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "JobEvents",
    "source": "packages/mcp/src/job-tools.ts:11",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "JobList",
    "source": "packages/mcp/src/job-tools.ts:9",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "JobResult",
    "source": "packages/mcp/src/job-tools.ts:12",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "JobStatus",
    "source": "packages/mcp/src/job-tools.ts:10",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "JobSubmit",
    "source": "packages/mcp/src/job-tools.ts:8",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "DaemonWorkflowPlan",
    "source": "packages/cli/src/jobs/workflow-job.ts:17",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "JobEvent",
    "source": "packages/core/src/jobs/job-service.ts:20",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "JobRecord",
    "source": "packages/core/src/jobs/job-service.ts:57",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "JobSnapshot",
    "source": "packages/core/src/jobs/job-service.ts:9",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "semantic-source-rule"
  },
  {
    "category": "statePaths",
    "id": "daemon",
    "source": "packages/cli/src/commands/daemon.ts:33",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/focus",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/jobs",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-jobs",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cliCommands:0015",
    "publicId": "daemon",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:325"
  },
  {
    "id": "cliCommands:0026",
    "publicId": "job",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:310"
  },
  {
    "id": "cliCommands:0027",
    "publicId": "job cancel",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/commands/job.ts:313"
  },
  {
    "id": "cliCommands:0028",
    "publicId": "job events",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/commands/job.ts:284"
  },
  {
    "id": "cliCommands:0029",
    "publicId": "job list",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/commands/job.ts:258"
  },
  {
    "id": "cliCommands:0030",
    "publicId": "job result",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/commands/job.ts:300"
  },
  {
    "id": "cliCommands:0031",
    "publicId": "job status",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/commands/job.ts:271"
  },
  {
    "id": "cliCommands:0032",
    "publicId": "job submit",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/commands/job.ts:229"
  },
  {
    "id": "intentVariants:0031",
    "publicId": "focus",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:49"
  },
  {
    "id": "intentVariants:0038",
    "publicId": "jobs",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:48"
  },
  {
    "id": "mcpTools:0010",
    "publicId": "JobCancel",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/job-tools.ts:13"
  },
  {
    "id": "mcpTools:0011",
    "publicId": "JobEvents",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/job-tools.ts:11"
  },
  {
    "id": "mcpTools:0012",
    "publicId": "JobList",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/job-tools.ts:9"
  },
  {
    "id": "mcpTools:0013",
    "publicId": "JobResult",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/job-tools.ts:12"
  },
  {
    "id": "mcpTools:0014",
    "publicId": "JobStatus",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/job-tools.ts:10"
  },
  {
    "id": "mcpTools:0015",
    "publicId": "JobSubmit",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/job-tools.ts:8"
  },
  {
    "id": "resultAndEnvelopeTypes:0040",
    "publicId": "DaemonWorkflowPlan",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/cli/src/jobs/workflow-job.ts:17"
  },
  {
    "id": "resultAndEnvelopeTypes:0071",
    "publicId": "JobEvent",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/jobs/job-service.ts:20"
  },
  {
    "id": "resultAndEnvelopeTypes:0072",
    "publicId": "JobRecord",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/jobs/job-service.ts:57"
  },
  {
    "id": "resultAndEnvelopeTypes:0073",
    "publicId": "JobSnapshot",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/jobs/job-service.ts:9"
  },
  {
    "id": "builtinCommandMetadata:0024",
    "publicId": "focus",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:61"
  },
  {
    "id": "builtinCommandMetadata:0029",
    "publicId": "jobs",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:60"
  },
  {
    "id": "tuiSlashCommands:0032",
    "publicId": "/focus",
    "registryKind": "tui-action",
    "category": "tuiSlashCommands",
    "source": "packages/cli/src/signals/intent.ts:56"
  },
  {
    "id": "tuiSlashCommands:0040",
    "publicId": "/jobs",
    "registryKind": "tui-action",
    "category": "tuiSlashCommands",
    "source": "packages/cli/src/signals/intent.ts:56"
  }
]);

export interface FirstPartyCompatibilityRuntime {
  command(kind: string, id: string, input: Json, context: InvocationContext): InvocationOutput;
  tool(kind: string, id: string, input: Json, context: InvocationContext): Awaitable<Json>;
  parseIntent(id: string, input: string): Awaitable<Json | undefined>;
  lifecycle(id: string, payload: Json, context: InvocationContext): Awaitable<void>;
  render(id: string, payload: Json): Awaitable<{ readonly text: string; readonly markdown?: string }>;
}

type FirstPartyServices = ModServices & { readonly firstPartyCompatibility?: FirstPartyCompatibilityRuntime };
const inputSchema = Object.freeze({ type: 'object', additionalProperties: true }) as Readonly<Record<string, Json>>;
const resultSchema = Object.freeze({ type: 'object', additionalProperties: true }) as Readonly<Record<string, Json>>;

export function createFirstPartyCompatibilityMod(runtime: FirstPartyCompatibilityRuntime): AgonModV1 {
  return Object.freeze({
    apiVersion: '1' as const,
    async activate(registrar: Registrar): Promise<Dispose> {
      const disposers: Dispose[] = [];
      disposers.push(registrar.command('cli', { id: "cliCommands:0015", description: "daemon compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "daemon", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0026", description: "job compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "job", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0027", description: "job cancel compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "job cancel", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0028", description: "job events compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "job events", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0029", description: "job list compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "job list", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0030", description: "job result compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "job result", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0031", description: "job status compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "job status", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0032", description: "job submit compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "job submit", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0031", description: "focus compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("focus", input), run: (input, context) => runtime.command('intent', "focus", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0038", description: "jobs compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("jobs", input), run: (input, context) => runtime.command('intent', "jobs", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0010", description: "JobCancel compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "JobCancel", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0011", description: "JobEvents compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "JobEvents", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0012", description: "JobList compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "JobList", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0013", description: "JobResult compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "JobResult", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0014", description: "JobStatus compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "JobStatus", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0015", description: "JobSubmit compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "JobSubmit", input, context) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0040", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("DaemonWorkflowPlan", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0071", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("JobEvent", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0072", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("JobRecord", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0073", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("JobSnapshot", payload) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0024", description: "focus compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "focus", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0029", description: "jobs compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "jobs", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0032", description: "/focus compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/focus", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0040", description: "/jobs compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/jobs", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-jobs requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
