import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.rag",
  "name": "Rag",
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
    "order": 301
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
      },
      {
        "id": "agon.dedup",
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
      "contentHash": "sha256:503b6fe74606dbd0a417180241887ef51ef80ffd9fb934b3ad552a303489f9e2",
      "bytes": 1649,
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
      "contentHash": "sha256:83bf8b9a0aac203a73204aff0523793b1325401916ae375df366a7a6fc3e9816",
      "bytes": 212,
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
        "id": "cliCommands:0059",
        "aliases": []
      }
    ],
    "tuiActions": [],
    "mcpTools": [
      {
        "id": "mcpTools:0017",
        "aliases": []
      }
    ],
    "cesarTools": [],
    "lifecycleHooks": [],
    "resultTypes": [
      {
        "id": "resultAndEnvelopeTypes:0102",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0103",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0104",
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
      "dist/store.d.ts",
      "dist/types.d.ts",
      "ownership.json",
      "schemas/config.schema.json"
    ],
    "executable": []
  }
});
export const SOURCE_OCCURRENCES = Object.freeze([
  {
    "category": "cliCommands",
    "id": "rag",
    "source": "packages/cli/src/lazy-commands.ts:317",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rag",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "ProjectContext",
    "source": "packages/mcp/src/project-context.ts:4",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rag",
    "rule": "exact-user-surface"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "RagEmbedResult",
    "source": "packages/core/src/rag/embed.ts:15",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rag",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "RagIndexResult",
    "source": "packages/mod-rag/src/types.ts:36",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rag",
    "rule": "physical-mod-owner"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "RagQueryResult",
    "source": "packages/mod-rag/src/types.ts:44",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rag",
    "rule": "physical-mod-owner"
  },
  {
    "category": "stateStoreModules",
    "id": "packages/mod-rag/src/store.ts",
    "source": "packages/mod-rag/src/store.ts",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rag",
    "rule": "physical-mod-owner"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cliCommands:0059",
    "publicId": "rag",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:317"
  },
  {
    "id": "mcpTools:0017",
    "publicId": "ProjectContext",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/project-context.ts:4"
  },
  {
    "id": "resultAndEnvelopeTypes:0102",
    "publicId": "RagEmbedResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/rag/embed.ts:15"
  },
  {
    "id": "resultAndEnvelopeTypes:0103",
    "publicId": "RagIndexResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/mod-rag/src/types.ts:36"
  },
  {
    "id": "resultAndEnvelopeTypes:0104",
    "publicId": "RagQueryResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/mod-rag/src/types.ts:44"
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
      disposers.push(registrar.command('cli', { id: "cliCommands:0059", description: "rag compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "rag", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0017", description: "ProjectContext compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "ProjectContext", input, context) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0102", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("RagEmbedResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0103", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("RagIndexResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0104", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("RagQueryResult", payload) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-rag requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
export * from './store.js';
export type * from './types.js';
