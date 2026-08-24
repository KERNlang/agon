import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.flow",
  "name": "Flow",
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
    "order": 305
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
      "contentHash": "sha256:4d375429633367a8dfbb5ad44a5b1136b4aa6b04d7e7e4d867df4f8dd359c52c",
      "bytes": 1651,
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
      "contentHash": "sha256:e8e61421916f9e7f87b0f184068cd0b759d3224d27fb3a3d1afefbfffd2f9122",
      "bytes": 214,
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
        "id": "intentVariants:0029",
        "aliases": []
      },
      {
        "id": "intentVariants:0030",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0022",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0023",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0030",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0031",
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
    "id": "flow",
    "source": "packages/core/src/blocks/builtin-commands.ts:57",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-flow",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "flows",
    "source": "packages/core/src/blocks/builtin-commands.ts:58",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-flow",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "flow",
    "source": "packages/cli/src/signals/intent-types.ts:33",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-flow",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "flows",
    "source": "packages/cli/src/signals/intent-types.ts:34",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-flow",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/flow",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-flow",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/flows",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-flow",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "intentVariants:0029",
    "publicId": "flow",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:33"
  },
  {
    "id": "intentVariants:0030",
    "publicId": "flows",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:34"
  },
  {
    "id": "builtinCommandMetadata:0022",
    "publicId": "flow",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:57"
  },
  {
    "id": "builtinCommandMetadata:0023",
    "publicId": "flows",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:58"
  },
  {
    "id": "tuiSlashCommands:0030",
    "publicId": "/flow",
    "registryKind": "tui-action",
    "category": "tuiSlashCommands",
    "source": "packages/cli/src/signals/intent.ts:56"
  },
  {
    "id": "tuiSlashCommands:0031",
    "publicId": "/flows",
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
      disposers.push(registrar.intent({ id: "intentVariants:0029", description: "flow compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("flow", input), run: (input, context) => runtime.command('intent', "flow", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0030", description: "flows compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("flows", input), run: (input, context) => runtime.command('intent', "flows", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0022", description: "flow compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "flow", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0023", description: "flows compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "flows", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0030", description: "/flow compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/flow", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0031", description: "/flows compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/flows", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-flow requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
