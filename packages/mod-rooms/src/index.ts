import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.rooms",
  "name": "Rooms",
  "version": "1.0.0",
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
  "permissions": [
    {
      "capability": "engine.dispatch",
      "resources": [],
      "required": true
    },
    {
      "capability": "fs.write",
      "resources": [],
      "required": true
    }
  ],
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
        "id": "cliCommands:0064",
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
      "LICENSE",
      "agon.mod.json",
      "dist/index.js",
      "dist/index.d.ts",
      "dist/implementation.d.ts",
      "dist/paths.d.ts",
      "dist/runtime/index.d.ts",
      "dist/runtime/store.d.ts",
      "dist/runtime/presence.d.ts",
      "dist/runtime/unread.d.ts",
      "dist/runtime/locks.d.ts",
      "dist/runtime/leases.d.ts",
      "dist/runtime/auto-policy.d.ts",
      "dist/runtime/tail.d.ts",
      "dist/runtime/tasks.d.ts",
      "dist/runtime/types.d.ts",
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
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { roomAction } from './implementation.js';
export * from './runtime/index.js';
