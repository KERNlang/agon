import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.history",
  "name": "History",
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
    "group": "Knowledge",
    "order": 303
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
      "contentHash": "sha256:9de22376fb7847ad9794b996c27de22e0b7a15f470187b1d0f204f571bba8342",
      "bytes": 1394,
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
      "contentHash": "sha256:8bf93d7ba57c9c898e4915f6e20a529514f4f64f02fe6e2b712420475630f0ad",
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
        "id": "cliCommands:0024",
        "aliases": []
      },
      {
        "id": "cliCommands:0033",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0035",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0027",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0037",
        "aliases": []
      }
    ],
    "mcpTools": [],
    "cesarTools": [],
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
    "id": "history",
    "source": "packages/core/src/blocks/builtin-commands.ts:55",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-history",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "history",
    "source": "packages/cli/src/lazy-commands.ts:295",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-history",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "last",
    "source": "packages/cli/src/lazy-commands.ts:301",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-history",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "history",
    "source": "packages/cli/src/signals/intent-types.ts:11",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-history",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/history",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-history",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cliCommands:0024",
    "publicId": "history",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:295"
  },
  {
    "id": "cliCommands:0033",
    "publicId": "last",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:301"
  },
  {
    "id": "intentVariants:0035",
    "publicId": "history",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:11"
  },
  {
    "id": "builtinCommandMetadata:0027",
    "publicId": "history",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:55"
  },
  {
    "id": "tuiSlashCommands:0037",
    "publicId": "/history",
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
      disposers.push(registrar.command('cli', { id: "cliCommands:0024", description: "history compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "history", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0033", description: "last compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "last", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0035", description: "history compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("history", input), run: (input, context) => runtime.command('intent', "history", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0027", description: "history compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "history", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0037", description: "/history compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/history", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-history requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
