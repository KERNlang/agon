import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.brainstorm",
  "name": "Brainstorm",
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
    "group": "Create and compete",
    "order": 100
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
        "id": "agon.panel",
        "range": ">=0.0.0-0"
      },
      {
        "id": "agon.dedup",
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
      "contentHash": "sha256:d3e81afaba7529c84d91023068f20a4fd1b80f4ff0c68403e353344df410b15d",
      "bytes": 3288,
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
      "contentHash": "sha256:9b320d8b5bee1302d0a6c17a761025f8bd80173267ec0ef68d31e4c17199d059",
      "bytes": 226,
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
        "id": "cliCommands:0003",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0005",
        "aliases": []
      },
      {
        "id": "intentVariants:0055",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0005",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0005",
        "aliases": []
      }
    ],
    "mcpTools": [
      {
        "id": "mcpTools:0004",
        "aliases": []
      }
    ],
    "cesarTools": [
      {
        "id": "cesarRoutes:0004",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0005",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0006",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0007",
        "aliases": []
      },
      {
        "id": "cesarTools:0002",
        "aliases": []
      }
    ],
    "lifecycleHooks": [],
    "resultTypes": [
      {
        "id": "resultAndEnvelopeTypes:0019",
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
    "id": "brainstorm",
    "source": "packages/core/src/blocks/builtin-commands.ts:15",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "brainstorm",
    "source": "packages/cli/src/cesar/routing.ts:19",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "brainstorm",
    "source": "packages/cli/src/cesar/routing.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "brainstorm",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "brainstorm",
    "source": "packages/core/src/cesar/plan.ts:52",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "Brainstorm",
    "source": "packages/cli/src/cesar/tools.ts:38",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "semantic-source-rule"
  },
  {
    "category": "cliCommands",
    "id": "brainstorm",
    "source": "packages/cli/src/lazy-commands.ts:288",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "brainstorm",
    "source": "packages/cli/src/signals/intent-types.ts:3",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "suggest-brainstorm",
    "source": "packages/cli/src/signals/intent-types.ts:55",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "Brainstorm",
    "source": "packages/mcp/src/agon-orchestration.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "BrainstormResult",
    "source": "packages/core/src/models/types.ts:531",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "semantic-source-rule"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/brainstorm",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cesarRoutes:0004",
    "publicId": "brainstorm",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:19"
  },
  {
    "id": "cesarRoutes:0005",
    "publicId": "brainstorm",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:27"
  },
  {
    "id": "cesarRoutes:0006",
    "publicId": "brainstorm",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/models/handler-types.ts:113"
  },
  {
    "id": "cesarRoutes:0007",
    "publicId": "brainstorm",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/core/src/cesar/plan.ts:52"
  },
  {
    "id": "cesarTools:0002",
    "publicId": "Brainstorm",
    "registryKind": "cesar-tool",
    "category": "cesarTools",
    "source": "packages/cli/src/cesar/tools.ts:38"
  },
  {
    "id": "cliCommands:0003",
    "publicId": "brainstorm",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:288"
  },
  {
    "id": "intentVariants:0005",
    "publicId": "brainstorm",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:3"
  },
  {
    "id": "intentVariants:0055",
    "publicId": "suggest-brainstorm",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:55"
  },
  {
    "id": "mcpTools:0004",
    "publicId": "Brainstorm",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/agon-orchestration.ts:24"
  },
  {
    "id": "resultAndEnvelopeTypes:0019",
    "publicId": "BrainstormResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/models/types.ts:531"
  },
  {
    "id": "builtinCommandMetadata:0005",
    "publicId": "brainstorm",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:15"
  },
  {
    "id": "tuiSlashCommands:0005",
    "publicId": "/brainstorm",
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
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0004", description: "brainstorm compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "brainstorm", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0005", description: "brainstorm compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "brainstorm", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0006", description: "brainstorm compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "brainstorm", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0007", description: "brainstorm compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "brainstorm", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarTools:0002", description: "Brainstorm compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "Brainstorm", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0003", description: "brainstorm compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "brainstorm", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0005", description: "brainstorm compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("brainstorm", input), run: (input, context) => runtime.command('intent', "brainstorm", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0055", description: "suggest-brainstorm compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("suggest-brainstorm", input), run: (input, context) => runtime.command('intent', "suggest-brainstorm", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0004", description: "Brainstorm compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "Brainstorm", input, context) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0019", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("BrainstormResult", payload) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0005", description: "brainstorm compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "brainstorm", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0005", description: "/brainstorm compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/brainstorm", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-brainstorm requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
