import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.review",
  "name": "Review",
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
    "order": 200
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
        "id": "agon.verification",
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
      "contentHash": "sha256:8bd4317f071425700d94d00c28ea9c534ca566e5a85c8d47d91b14570268d37b",
      "bytes": 4492,
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
      "contentHash": "sha256:e0ff6a2a0e8b76240883b4118c88e0798af3f82e709e36a54e62e0149837c146",
      "bytes": 218,
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
        "id": "cliCommands:0054",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0051",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0040",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0057",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0058",
        "aliases": []
      }
    ],
    "mcpTools": [
      {
        "id": "mcpTools:0021",
        "aliases": []
      }
    ],
    "cesarTools": [
      {
        "id": "cesarRoutes:0042",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0043",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0044",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0045",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0046",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0047",
        "aliases": []
      },
      {
        "id": "cesarTools:0023",
        "aliases": []
      }
    ],
    "lifecycleHooks": [],
    "resultTypes": [
      {
        "id": "resultAndEnvelopeTypes:0107",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0108",
        "aliases": []
      }
    ],
    "configKeys": [
      {
        "id": "configKeys:0007",
        "aliases": []
      },
      {
        "id": "configKeys:0087",
        "aliases": []
      }
    ],
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
    "id": "review",
    "source": "packages/core/src/blocks/builtin-commands.ts:28",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "review",
    "source": "packages/cli/src/cesar/routing.ts:17",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "review",
    "source": "packages/cli/src/cesar/routing.ts:19",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "review",
    "source": "packages/cli/src/cesar/routing.ts:25",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "review",
    "source": "packages/cli/src/cesar/routing.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "review",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "review",
    "source": "packages/core/src/cesar/plan.ts:52",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "Review",
    "source": "packages/cli/src/cesar/tools.ts:45",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "semantic-source-rule"
  },
  {
    "category": "cliCommands",
    "id": "review",
    "source": "packages/cli/src/lazy-commands.ts:305",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "configKeys",
    "id": "autoReviewAfterImpl",
    "source": "packages/core/src/models/types.ts:176",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "semantic-source-rule"
  },
  {
    "category": "configKeys",
    "id": "goalReviewEngines",
    "source": "packages/core/src/models/types.ts:75",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "semantic-source-rule"
  },
  {
    "category": "intentVariants",
    "id": "review",
    "source": "packages/cli/src/signals/intent-types.ts:42",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "Review",
    "source": "packages/mcp/src/agon-orchestration.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "ReviewCoreResult",
    "source": "packages/cli/src/handlers/review.ts:332",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "ReviewEvent",
    "source": "packages/cli/src/blocks/controls.tsx:20",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "semantic-source-rule"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/review",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/review role",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cesarRoutes:0042",
    "publicId": "review",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:17"
  },
  {
    "id": "cesarRoutes:0043",
    "publicId": "review",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:19"
  },
  {
    "id": "cesarRoutes:0044",
    "publicId": "review",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:25"
  },
  {
    "id": "cesarRoutes:0045",
    "publicId": "review",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:27"
  },
  {
    "id": "cesarRoutes:0046",
    "publicId": "review",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/models/handler-types.ts:113"
  },
  {
    "id": "cesarRoutes:0047",
    "publicId": "review",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/core/src/cesar/plan.ts:52"
  },
  {
    "id": "cesarTools:0023",
    "publicId": "Review",
    "registryKind": "cesar-tool",
    "category": "cesarTools",
    "source": "packages/cli/src/cesar/tools.ts:45"
  },
  {
    "id": "cliCommands:0054",
    "publicId": "review",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:305"
  },
  {
    "id": "configKeys:0007",
    "publicId": "autoReviewAfterImpl",
    "registryKind": "config",
    "category": "configKeys",
    "source": "packages/core/src/models/types.ts:176"
  },
  {
    "id": "configKeys:0087",
    "publicId": "goalReviewEngines",
    "registryKind": "config",
    "category": "configKeys",
    "source": "packages/core/src/models/types.ts:75"
  },
  {
    "id": "intentVariants:0051",
    "publicId": "review",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:42"
  },
  {
    "id": "mcpTools:0021",
    "publicId": "Review",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/agon-orchestration.ts:24"
  },
  {
    "id": "resultAndEnvelopeTypes:0107",
    "publicId": "ReviewCoreResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/cli/src/handlers/review.ts:332"
  },
  {
    "id": "resultAndEnvelopeTypes:0108",
    "publicId": "ReviewEvent",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/cli/src/blocks/controls.tsx:20"
  },
  {
    "id": "builtinCommandMetadata:0040",
    "publicId": "review",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:28"
  },
  {
    "id": "tuiSlashCommands:0057",
    "publicId": "/review",
    "registryKind": "tui-action",
    "category": "tuiSlashCommands",
    "source": "packages/cli/src/signals/intent.ts:56"
  },
  {
    "id": "tuiSlashCommands:0058",
    "publicId": "/review role",
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
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0042", description: "review compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "review", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0043", description: "review compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "review", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0044", description: "review compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "review", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0045", description: "review compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "review", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0046", description: "review compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "review", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0047", description: "review compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "review", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarTools:0023", description: "Review compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "Review", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0054", description: "review compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "review", input, context) }));
      disposers.push(registrar.config("configKeys:0007", inputSchema));
      disposers.push(registrar.config("configKeys:0087", inputSchema));
      disposers.push(registrar.intent({ id: "intentVariants:0051", description: "review compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("review", input), run: (input, context) => runtime.command('intent', "review", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0021", description: "Review compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "Review", input, context) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0107", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("ReviewCoreResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0108", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("ReviewEvent", payload) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0040", description: "review compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "review", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0057", description: "/review compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/review", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0058", description: "/review role compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/review role", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-review requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
