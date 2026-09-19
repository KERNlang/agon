import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.ratings",
  "name": "Ratings",
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
  "permissions": [
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
        "id": "cliCommands:0060",
        "aliases": []
      },
      {
        "id": "cliCommands:0061",
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
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runRatings, loadRatings, computeUnknownEngineIds } from './implementation.js';
