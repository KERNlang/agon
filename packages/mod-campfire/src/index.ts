import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.campfire",
  "name": "Campfire",
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
    "order": 102
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
      "contentHash": "sha256:43158205f822cd50a772e5c6982448aaaaa45a6b46e823ed20bfd41a980bea45",
      "bytes": 2691,
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
      "contentHash": "sha256:b6582132d49f3af8f577eeacb1093e34f5d2d0ed3fbea5b9c20db17b39a837cb",
      "bytes": 222,
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
        "id": "cliCommands:0010",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0007",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0008",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0008",
        "aliases": []
      }
    ],
    "mcpTools": [
      {
        "id": "mcpTools:0005",
        "aliases": []
      }
    ],
    "cesarTools": [
      {
        "id": "cesarRoutes:0010",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0011",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0012",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0013",
        "aliases": []
      },
      {
        "id": "cesarTools:0003",
        "aliases": []
      }
    ],
    "lifecycleHooks": [],
    "resultTypes": [],
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
    "id": "campfire",
    "source": "packages/core/src/blocks/builtin-commands.ts:17",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "campfire",
    "source": "packages/cli/src/cesar/routing.ts:19",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "campfire",
    "source": "packages/cli/src/cesar/routing.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "campfire",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "campfire",
    "source": "packages/core/src/cesar/plan.ts:52",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "Campfire",
    "source": "packages/cli/src/cesar/tools.ts:40",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "semantic-source-rule"
  },
  {
    "category": "cliCommands",
    "id": "campfire",
    "source": "packages/cli/src/lazy-commands.ts:290",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "campfire",
    "source": "packages/cli/src/signals/intent-types.ts:14",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "Campfire",
    "source": "packages/mcp/src/agon-orchestration.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "semantic-source-rule"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/campfire",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cesarRoutes:0010",
    "publicId": "campfire",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:19"
  },
  {
    "id": "cesarRoutes:0011",
    "publicId": "campfire",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:27"
  },
  {
    "id": "cesarRoutes:0012",
    "publicId": "campfire",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/models/handler-types.ts:113"
  },
  {
    "id": "cesarRoutes:0013",
    "publicId": "campfire",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/core/src/cesar/plan.ts:52"
  },
  {
    "id": "cesarTools:0003",
    "publicId": "Campfire",
    "registryKind": "cesar-tool",
    "category": "cesarTools",
    "source": "packages/cli/src/cesar/tools.ts:40"
  },
  {
    "id": "cliCommands:0010",
    "publicId": "campfire",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:290"
  },
  {
    "id": "intentVariants:0007",
    "publicId": "campfire",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:14"
  },
  {
    "id": "mcpTools:0005",
    "publicId": "Campfire",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/agon-orchestration.ts:24"
  },
  {
    "id": "builtinCommandMetadata:0008",
    "publicId": "campfire",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:17"
  },
  {
    "id": "tuiSlashCommands:0008",
    "publicId": "/campfire",
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
const _resultSchema = Object.freeze({ type: 'object', additionalProperties: true }) as Readonly<Record<string, Json>>;

export function createFirstPartyCompatibilityMod(runtime: FirstPartyCompatibilityRuntime): AgonModV1 {
  return Object.freeze({
    apiVersion: '1' as const,
    async activate(registrar: Registrar): Promise<Dispose> {
      const disposers: Dispose[] = [];
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0010", description: "campfire compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "campfire", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0011", description: "campfire compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "campfire", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0012", description: "campfire compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "campfire", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0013", description: "campfire compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "campfire", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarTools:0003", description: "Campfire compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "Campfire", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0010", description: "campfire compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "campfire", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0007", description: "campfire compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("campfire", input), run: (input, context) => runtime.command('intent', "campfire", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0005", description: "Campfire compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "Campfire", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0008", description: "campfire compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "campfire", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0008", description: "/campfire compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/campfire", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-campfire requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
