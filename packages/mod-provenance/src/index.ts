import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.provenance",
  "name": "Provenance",
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
    "order": 304
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
      "contentHash": "sha256:ecfc0e69157008eb04c3e79a23e7dcd728a42257c3a71e0dcc3d6d475860208a",
      "bytes": 1231,
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
      "contentHash": "sha256:54661acb4f56e0699dfa9d3b84e4b1c16ccb1666644becce0abad7f7062c783a",
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
        "id": "cliCommands:0057",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "builtinCommandMetadata:0037",
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
    "id": "provenance",
    "source": "packages/core/src/blocks/builtin-commands.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-provenance",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "provenance",
    "source": "packages/cli/src/lazy-commands.ts:298",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-provenance",
    "rule": "exact-user-surface"
  },
  {
    "category": "stateStoreModules",
    "id": "packages/cli/src/commands/provenance.ts",
    "source": "packages/cli/src/commands/provenance.ts",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-provenance",
    "rule": "semantic-source-rule"
  },
  {
    "category": "stateStoreModules",
    "id": "packages/core/src/blocks/provenance.ts",
    "source": "packages/core/src/blocks/provenance.ts",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-provenance",
    "rule": "semantic-source-rule"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cliCommands:0057",
    "publicId": "provenance",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:298"
  },
  {
    "id": "builtinCommandMetadata:0037",
    "publicId": "provenance",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:56"
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
      disposers.push(registrar.command('cli', { id: "cliCommands:0057", description: "provenance compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "provenance", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0037", description: "provenance compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "provenance", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-provenance requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
