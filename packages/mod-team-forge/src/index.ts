import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.team-forge",
  "name": "Team Forge",
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
    "order": 104,
    "parent": "agon.forge"
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
        "id": "agon.forge",
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
      "contentHash": "sha256:4157f329576093cb7672f0c72a109af1edf10ab6e46e6da134f8224eb7a5fb7c",
      "bytes": 1692,
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
      "contentHash": "sha256:c16df13158b703d63e40c363db8d7aebd242ccb8d8ae14166a7c34b8cd5530d5",
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
        "id": "cliCommands:0060",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0060",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0045",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0065",
        "aliases": []
      }
    ],
    "mcpTools": [],
    "cesarTools": [
      {
        "id": "cesarRoutes:0062",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0064",
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
    "id": "team-forge",
    "source": "packages/core/src/blocks/builtin-commands.ts:18",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-team-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "team-forge",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-team-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "teamforge",
    "source": "packages/core/src/cesar/plan.ts:52",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-team-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "team-forge",
    "source": "packages/cli/src/lazy-commands.ts:291",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-team-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "team-forge",
    "source": "packages/cli/src/signals/intent-types.ts:6",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-team-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/team-forge",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-team-forge",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cesarRoutes:0062",
    "publicId": "team-forge",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/models/handler-types.ts:113"
  },
  {
    "id": "cesarRoutes:0064",
    "publicId": "teamforge",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/core/src/cesar/plan.ts:52"
  },
  {
    "id": "cliCommands:0060",
    "publicId": "team-forge",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:291"
  },
  {
    "id": "intentVariants:0060",
    "publicId": "team-forge",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:6"
  },
  {
    "id": "builtinCommandMetadata:0045",
    "publicId": "team-forge",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:18"
  },
  {
    "id": "tuiSlashCommands:0065",
    "publicId": "/team-forge",
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
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0062", description: "team-forge compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "team-forge", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0064", description: "teamforge compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "teamforge", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0060", description: "team-forge compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "team-forge", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0060", description: "team-forge compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("team-forge", input), run: (input, context) => runtime.command('intent', "team-forge", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0045", description: "team-forge compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "team-forge", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0065", description: "/team-forge compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/team-forge", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-team-forge requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
