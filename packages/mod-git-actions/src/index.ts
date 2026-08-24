import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.git-actions",
  "name": "Git Actions",
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
    "order": 503
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
      "contentHash": "sha256:d850c74dfc246e3178f4f065c663321755dda42451e9e5b665adf26829f4ee5d",
      "bytes": 1703,
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
      "contentHash": "sha256:89aac656345d232570e8a6233af760ea249be5b714de7c481b94405c0ab2776b",
      "bytes": 228,
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
    "cliCommands": [],
    "tuiActions": [
      {
        "id": "intentVariants:0017",
        "aliases": []
      },
      {
        "id": "intentVariants:0064",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0013",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0049",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0018",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0070",
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
    "id": "commit",
    "source": "packages/core/src/blocks/builtin-commands.ts:31",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-git-actions",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "undo",
    "source": "packages/core/src/blocks/builtin-commands.ts:33",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-git-actions",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "commit",
    "source": "packages/cli/src/signals/intent-types.ts:45",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-git-actions",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "undo",
    "source": "packages/cli/src/signals/intent-types.ts:46",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-git-actions",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/commit",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-git-actions",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/undo",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-git-actions",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "intentVariants:0017",
    "publicId": "commit",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:45"
  },
  {
    "id": "intentVariants:0064",
    "publicId": "undo",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:46"
  },
  {
    "id": "builtinCommandMetadata:0013",
    "publicId": "commit",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:31"
  },
  {
    "id": "builtinCommandMetadata:0049",
    "publicId": "undo",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:33"
  },
  {
    "id": "tuiSlashCommands:0018",
    "publicId": "/commit",
    "registryKind": "tui-action",
    "category": "tuiSlashCommands",
    "source": "packages/cli/src/signals/intent.ts:56"
  },
  {
    "id": "tuiSlashCommands:0070",
    "publicId": "/undo",
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
      disposers.push(registrar.intent({ id: "intentVariants:0017", description: "commit compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("commit", input), run: (input, context) => runtime.command('intent', "commit", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0064", description: "undo compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("undo", input), run: (input, context) => runtime.command('intent', "undo", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0013", description: "commit compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "commit", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0049", description: "undo compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "undo", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0018", description: "/commit compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/commit", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0070", description: "/undo compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/undo", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-git-actions requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
