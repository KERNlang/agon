import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.campfire",
  "name": "Campfire",
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
    "group": "Create and compete",
    "order": 102
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
        "id": "agon.panel",
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
      "contentHash": "sha256:43158205f822cd50a772e5c6982448aaaaa45a6b46e823ed20bfd41a980bea45",
      "bytes": 2691,
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
      "contentHash": "sha256:b6582132d49f3af8f577eeacb1093e34f5d2d0ed3fbea5b9c20db17b39a837cb",
      "bytes": 222,
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
        "id": "cliCommands:0010",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0007",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0008",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0008",
        "aliases": []
      }
    ],
    "mcpTools": [
      {
        "id": "mcpTools:0005",
        "aliases": []
      }
    ],
    "cesarTools": [
      {
        "id": "cesarTools:0003",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0010",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0011",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0012",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0013",
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
      "LICENSE",
      "agon.mod.json",
      "dist/index.js",
      "dist/index.d.ts",
      "dist/implementation.d.ts",
      "ownership.json",
      "schemas/config.schema.json"
    ],
    "executable": []
  }
});
export const SOURCE_OCCURRENCES = Object.freeze([
  {
    "category": "builtinCommandMetadata",
    "id": "campfire",
    "source": "packages/core/src/blocks/builtin-commands.ts:17",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "campfire",
    "source": "packages/cli/src/cesar/routing.ts:19",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "campfire",
    "source": "packages/cli/src/cesar/routing.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "campfire",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "campfire",
    "source": "packages/core/src/cesar/plan.ts:52",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "Campfire",
    "source": "packages/cli/src/cesar/tools.ts:40",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "semantic-source-rule"
  },
  {
    "category": "cliCommands",
    "id": "campfire",
    "source": "packages/cli/src/lazy-commands.ts:290",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "campfire",
    "source": "packages/cli/src/signals/intent-types.ts:14",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "Campfire",
    "source": "packages/mcp/src/agon-orchestration.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "semantic-source-rule"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/campfire",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-campfire",
    "rule": "exact-user-surface"
  }
]);
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
