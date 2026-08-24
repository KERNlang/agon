import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.rooms",
  "name": "Rooms",
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
    "order": 500
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
      "contentHash": "sha256:65f3ef5fb0c85adc045cdd1174ea7b5b6033d8e6b8680a2ddca95a91617f8620",
      "bytes": 3658,
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
      "contentHash": "sha256:3fdec12bd052ba899ed2ba94250e1484edde3667f77dc1e4922e7dfae059e145",
      "bytes": 216,
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
        "id": "cliCommands:0055",
        "aliases": []
      }
    ],
    "tuiActions": [],
    "mcpTools": [
      {
        "id": "mcpTools:0022",
        "aliases": []
      },
      {
        "id": "mcpTools:0023",
        "aliases": []
      },
      {
        "id": "mcpTools:0024",
        "aliases": []
      },
      {
        "id": "mcpTools:0025",
        "aliases": []
      },
      {
        "id": "mcpTools:0026",
        "aliases": []
      },
      {
        "id": "mcpTools:0027",
        "aliases": []
      },
      {
        "id": "mcpTools:0028",
        "aliases": []
      },
      {
        "id": "mcpTools:0029",
        "aliases": []
      }
    ],
    "cesarTools": [],
    "lifecycleHooks": [],
    "resultTypes": [
      {
        "id": "resultAndEnvelopeTypes:0109",
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
    "category": "cliCommands",
    "id": "room",
    "source": "packages/cli/src/lazy-commands.ts:297",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rooms",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "RoomJoin",
    "source": "packages/mcp/src/rooms.ts:8",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rooms",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "RoomLeave",
    "source": "packages/mcp/src/rooms.ts:14",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rooms",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "RoomList",
    "source": "packages/mcp/src/rooms.ts:15",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rooms",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "RoomLock",
    "source": "packages/mcp/src/rooms.ts:12",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rooms",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "RoomPost",
    "source": "packages/mcp/src/rooms.ts:9",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rooms",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "RoomRead",
    "source": "packages/mcp/src/rooms.ts:10",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rooms",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "RoomRelease",
    "source": "packages/mcp/src/rooms.ts:13",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rooms",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "RoomWho",
    "source": "packages/mcp/src/rooms.ts:11",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rooms",
    "rule": "exact-user-surface"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "RoomEvent",
    "source": "packages/core/src/rooms/types.ts:10",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rooms",
    "rule": "semantic-source-rule"
  },
  {
    "category": "stateStoreModules",
    "id": "packages/core/src/rooms/leases.ts",
    "source": "packages/core/src/rooms/leases.ts",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rooms",
    "rule": "semantic-source-rule"
  },
  {
    "category": "stateStoreModules",
    "id": "packages/core/src/rooms/presence.ts",
    "source": "packages/core/src/rooms/presence.ts",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rooms",
    "rule": "semantic-source-rule"
  },
  {
    "category": "stateStoreModules",
    "id": "packages/core/src/rooms/store.ts",
    "source": "packages/core/src/rooms/store.ts",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rooms",
    "rule": "semantic-source-rule"
  },
  {
    "category": "stateStoreModules",
    "id": "packages/core/src/rooms/tail.ts",
    "source": "packages/core/src/rooms/tail.ts",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rooms",
    "rule": "semantic-source-rule"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cliCommands:0055",
    "publicId": "room",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:297"
  },
  {
    "id": "mcpTools:0022",
    "publicId": "RoomJoin",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/rooms.ts:8"
  },
  {
    "id": "mcpTools:0023",
    "publicId": "RoomLeave",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/rooms.ts:14"
  },
  {
    "id": "mcpTools:0024",
    "publicId": "RoomList",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/rooms.ts:15"
  },
  {
    "id": "mcpTools:0025",
    "publicId": "RoomLock",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/rooms.ts:12"
  },
  {
    "id": "mcpTools:0026",
    "publicId": "RoomPost",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/rooms.ts:9"
  },
  {
    "id": "mcpTools:0027",
    "publicId": "RoomRead",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/rooms.ts:10"
  },
  {
    "id": "mcpTools:0028",
    "publicId": "RoomRelease",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/rooms.ts:13"
  },
  {
    "id": "mcpTools:0029",
    "publicId": "RoomWho",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/rooms.ts:11"
  },
  {
    "id": "resultAndEnvelopeTypes:0109",
    "publicId": "RoomEvent",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/rooms/types.ts:10"
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
      disposers.push(registrar.command('cli', { id: "cliCommands:0055", description: "room compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "room", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0022", description: "RoomJoin compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "RoomJoin", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0023", description: "RoomLeave compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "RoomLeave", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0024", description: "RoomList compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "RoomList", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0025", description: "RoomLock compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "RoomLock", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0026", description: "RoomPost compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "RoomPost", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0027", description: "RoomRead compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "RoomRead", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0028", description: "RoomRelease compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "RoomRelease", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0029", description: "RoomWho compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "RoomWho", input, context) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0109", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("RoomEvent", payload) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-rooms requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
