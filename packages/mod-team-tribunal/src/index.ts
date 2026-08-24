import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.team-tribunal",
  "name": "Team Tribunal",
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
    "order": 202,
    "parent": "agon.tribunal"
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
        "id": "agon.tribunal",
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
      "contentHash": "sha256:55053dd171b8d1e974d36a7cd7a5c499637a23da202990a3b2a683bc4ecd02a1",
      "bytes": 1469,
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
      "contentHash": "sha256:4818f9274d17c27a194d1b38d4176a10450b73ff6ee63eab1462ca0f904548a1",
      "bytes": 232,
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
        "id": "cliCommands:0061",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0061",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0046",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0066",
        "aliases": []
      }
    ],
    "mcpTools": [],
    "cesarTools": [
      {
        "id": "cesarRoutes:0063",
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
    "id": "team-tribunal",
    "source": "packages/core/src/blocks/builtin-commands.ts:19",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-team-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "team-tribunal",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-team-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "team-tribunal",
    "source": "packages/cli/src/lazy-commands.ts:293",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-team-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "team-tribunal",
    "source": "packages/cli/src/signals/intent-types.ts:5",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-team-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/team-tribunal",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-team-tribunal",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cesarRoutes:0063",
    "publicId": "team-tribunal",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/models/handler-types.ts:113"
  },
  {
    "id": "cliCommands:0061",
    "publicId": "team-tribunal",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:293"
  },
  {
    "id": "intentVariants:0061",
    "publicId": "team-tribunal",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:5"
  },
  {
    "id": "builtinCommandMetadata:0046",
    "publicId": "team-tribunal",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:19"
  },
  {
    "id": "tuiSlashCommands:0066",
    "publicId": "/team-tribunal",
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
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0063", description: "team-tribunal compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "team-tribunal", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0061", description: "team-tribunal compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "team-tribunal", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0061", description: "team-tribunal compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("team-tribunal", input), run: (input, context) => runtime.command('intent', "team-tribunal", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0046", description: "team-tribunal compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "team-tribunal", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0066", description: "/team-tribunal compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/team-tribunal", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-team-tribunal requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
