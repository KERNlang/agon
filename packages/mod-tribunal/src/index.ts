import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.tribunal",
  "name": "Tribunal",
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
    "group": "Review and decide",
    "order": 201
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
        "id": "agon.judge",
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
      "contentHash": "sha256:def6b68f0a1d289d2602d89d86fa03032f686b96eb5f722ab0e2a6e5270b93c6",
      "bytes": 3234,
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
      "contentHash": "sha256:02686441e5bd4265ddfdecadc361300e2bb08d10141bd986b4be8bea58b4d104",
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
        "id": "cliCommands:0063",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0057",
        "aliases": []
      },
      {
        "id": "intentVariants:0063",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0048",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0069",
        "aliases": []
      }
    ],
    "mcpTools": [
      {
        "id": "mcpTools:0032",
        "aliases": []
      }
    ],
    "cesarTools": [
      {
        "id": "cesarRoutes:0066",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0067",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0068",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0069",
        "aliases": []
      },
      {
        "id": "cesarTools:0026",
        "aliases": []
      }
    ],
    "lifecycleHooks": [],
    "resultTypes": [
      {
        "id": "resultAndEnvelopeTypes:0139",
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
    "id": "tribunal",
    "source": "packages/core/src/blocks/builtin-commands.ts:16",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "tribunal",
    "source": "packages/cli/src/cesar/routing.ts:19",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "tribunal",
    "source": "packages/cli/src/cesar/routing.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "tribunal",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "tribunal",
    "source": "packages/core/src/cesar/plan.ts:52",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "Tribunal",
    "source": "packages/cli/src/cesar/tools.ts:39",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "semantic-source-rule"
  },
  {
    "category": "cliCommands",
    "id": "tribunal",
    "source": "packages/cli/src/lazy-commands.ts:289",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "suggest-tribunal",
    "source": "packages/cli/src/signals/intent-types.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "tribunal",
    "source": "packages/cli/src/signals/intent-types.ts:4",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "Tribunal",
    "source": "packages/mcp/src/agon-orchestration.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "TribunalResult",
    "source": "packages/forge/src/tribunal.ts:28",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "semantic-source-rule"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/tribunal",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cesarRoutes:0066",
    "publicId": "tribunal",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:19"
  },
  {
    "id": "cesarRoutes:0067",
    "publicId": "tribunal",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:27"
  },
  {
    "id": "cesarRoutes:0068",
    "publicId": "tribunal",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/models/handler-types.ts:113"
  },
  {
    "id": "cesarRoutes:0069",
    "publicId": "tribunal",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/core/src/cesar/plan.ts:52"
  },
  {
    "id": "cesarTools:0026",
    "publicId": "Tribunal",
    "registryKind": "cesar-tool",
    "category": "cesarTools",
    "source": "packages/cli/src/cesar/tools.ts:39"
  },
  {
    "id": "cliCommands:0063",
    "publicId": "tribunal",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:289"
  },
  {
    "id": "intentVariants:0057",
    "publicId": "suggest-tribunal",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:56"
  },
  {
    "id": "intentVariants:0063",
    "publicId": "tribunal",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:4"
  },
  {
    "id": "mcpTools:0032",
    "publicId": "Tribunal",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/agon-orchestration.ts:24"
  },
  {
    "id": "resultAndEnvelopeTypes:0139",
    "publicId": "TribunalResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/tribunal.ts:28"
  },
  {
    "id": "builtinCommandMetadata:0048",
    "publicId": "tribunal",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:16"
  },
  {
    "id": "tuiSlashCommands:0069",
    "publicId": "/tribunal",
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
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0066", description: "tribunal compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "tribunal", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0067", description: "tribunal compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "tribunal", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0068", description: "tribunal compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "tribunal", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0069", description: "tribunal compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "tribunal", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarTools:0026", description: "Tribunal compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "Tribunal", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0063", description: "tribunal compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "tribunal", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0057", description: "suggest-tribunal compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("suggest-tribunal", input), run: (input, context) => runtime.command('intent', "suggest-tribunal", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0063", description: "tribunal compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("tribunal", input), run: (input, context) => runtime.command('intent', "tribunal", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0032", description: "Tribunal compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "Tribunal", input, context) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0139", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("TribunalResult", payload) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0048", description: "tribunal compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "tribunal", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0069", description: "/tribunal compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/tribunal", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-tribunal requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
