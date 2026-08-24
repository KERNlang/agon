import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.ratings",
  "name": "Ratings",
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
    "group": "Interfaces",
    "order": 601
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
      "contentHash": "sha256:d4ebc429372786f32bd40d3412ac9fba0ef06a1d630246d67ea3a2586341e744",
      "bytes": 2808,
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
      "contentHash": "sha256:c1f19f9df147f4779c44c594f5965536708635b538f856b6731fb5163928371c",
      "bytes": 220,
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
        "id": "cliCommands:0034",
        "aliases": []
      },
      {
        "id": "cliCommands:0051",
        "aliases": []
      },
      {
        "id": "cliCommands:0052",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0039",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0030",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0041",
        "aliases": []
      }
    ],
    "mcpTools": [],
    "cesarTools": [],
    "lifecycleHooks": [],
    "resultTypes": [
      {
        "id": "resultAndEnvelopeTypes:0105",
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
    "id": "leaderboard",
    "source": "packages/core/src/blocks/builtin-commands.ts:54",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-ratings",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "leaderboard",
    "source": "packages/cli/src/lazy-commands.ts:294",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-ratings",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "ratings",
    "source": "packages/cli/src/lazy-commands.ts:296",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-ratings",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "ratings purge-unknown",
    "source": "packages/cli/src/commands/ratings.ts:18",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-ratings",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "leaderboard",
    "source": "packages/cli/src/signals/intent-types.ts:8",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-ratings",
    "rule": "exact-user-surface"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "RatingRecord",
    "source": "packages/core/src/models/types.ts:55",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-ratings",
    "rule": "semantic-source-rule"
  },
  {
    "category": "statePaths",
    "id": "ratings.json",
    "source": "packages/core/src/signals/ratings-maintenance.ts:121",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-ratings",
    "rule": "semantic-source-rule"
  },
  {
    "category": "statePaths",
    "id": "runs",
    "source": "packages/core/src/signals/ratings-maintenance.ts:93",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-ratings",
    "rule": "semantic-source-rule"
  },
  {
    "category": "stateStoreModules",
    "id": "packages/core/src/signals/ratings-maintenance.ts",
    "source": "packages/core/src/signals/ratings-maintenance.ts",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-ratings",
    "rule": "semantic-source-rule"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/leaderboard",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-ratings",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cliCommands:0034",
    "publicId": "leaderboard",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:294"
  },
  {
    "id": "cliCommands:0051",
    "publicId": "ratings",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:296"
  },
  {
    "id": "cliCommands:0052",
    "publicId": "ratings purge-unknown",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/commands/ratings.ts:18"
  },
  {
    "id": "intentVariants:0039",
    "publicId": "leaderboard",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:8"
  },
  {
    "id": "resultAndEnvelopeTypes:0105",
    "publicId": "RatingRecord",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/models/types.ts:55"
  },
  {
    "id": "builtinCommandMetadata:0030",
    "publicId": "leaderboard",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:54"
  },
  {
    "id": "tuiSlashCommands:0041",
    "publicId": "/leaderboard",
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
      disposers.push(registrar.command('cli', { id: "cliCommands:0034", description: "leaderboard compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "leaderboard", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0051", description: "ratings compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "ratings", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0052", description: "ratings purge-unknown compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "ratings purge-unknown", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0039", description: "leaderboard compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("leaderboard", input), run: (input, context) => runtime.command('intent', "leaderboard", input, context) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0105", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("RatingRecord", payload) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0030", description: "leaderboard compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "leaderboard", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0041", description: "/leaderboard compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/leaderboard", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-ratings requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
