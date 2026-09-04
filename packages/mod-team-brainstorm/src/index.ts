import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.team-brainstorm",
  "name": "Team Brainstorm",
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
    "order": 101,
    "parent": "agon.brainstorm"
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
        "id": "agon.brainstorm",
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
      "contentHash": "sha256:8e603c704bba573073116f5d347f752eea81874f7e2e3ee9c3025a4d614c3ee0",
      "bytes": 1491,
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
      "contentHash": "sha256:5ceb6a077db20ec84b58024199a4213993f1c6fa1bc29200c33da32423db5b2b",
      "bytes": 236,
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
        "id": "cliCommands:0068",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0059",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0044",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0064",
        "aliases": []
      }
    ],
    "mcpTools": [],
    "cesarTools": [
      {
        "id": "cesarRoutes:0061",
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
    "id": "team-brainstorm",
    "source": "packages/core/src/blocks/builtin-commands.ts:20",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-team-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "team-brainstorm",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-team-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "team-brainstorm",
    "source": "packages/cli/src/lazy-commands.ts:292",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-team-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "team-brainstorm",
    "source": "packages/cli/src/signals/intent-types.ts:7",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-team-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/team-brainstorm",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-team-brainstorm",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cesarRoutes:0061",
    "publicId": "team-brainstorm",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/models/handler-types.ts:113"
  },
  {
    "id": "cliCommands:0068",
    "publicId": "team-brainstorm",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:292"
  },
  {
    "id": "intentVariants:0059",
    "publicId": "team-brainstorm",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:7"
  },
  {
    "id": "builtinCommandMetadata:0044",
    "publicId": "team-brainstorm",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:20"
  },
  {
    "id": "tuiSlashCommands:0064",
    "publicId": "/team-brainstorm",
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
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0061", description: "team-brainstorm compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "team-brainstorm", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0068", description: "team-brainstorm compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "team-brainstorm", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0059", description: "team-brainstorm compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("team-brainstorm", input), run: (input, context) => runtime.command('intent', "team-brainstorm", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0044", description: "team-brainstorm compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "team-brainstorm", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0064", description: "/team-brainstorm compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/team-brainstorm", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-team-brainstorm requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
