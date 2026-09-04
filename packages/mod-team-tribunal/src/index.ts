import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.team-tribunal",
  "name": "Team Tribunal",
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
        "id": "cliCommands:0070",
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
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
