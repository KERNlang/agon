import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.mutate",
  "name": "Mutate",
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
    "group": "Transform",
    "order": 400
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
      },
      {
        "id": "agon.worktree",
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
      "contentHash": "sha256:2759e79dc120744ce0cae602a1f2740f7d98379df762d154d321afe2b1b8cee9",
      "bytes": 864,
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
      "contentHash": "sha256:5feac0d55f28200c232178c8cf26cf306158010f7b66458f8e49cd9f04c08506",
      "bytes": 218,
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
        "id": "cliCommands:0054",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "tuiSlashCommands:0045",
        "aliases": []
      }
    ],
    "mcpTools": [],
    "cesarTools": [],
    "lifecycleHooks": [],
    "resultTypes": [],
    "configKeys": [
      {
        "id": "configKeys:0041",
        "aliases": []
      }
    ],
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
    "category": "cliCommands",
    "id": "mutate",
    "source": "packages/cli/src/lazy-commands.ts:309",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-mutate",
    "rule": "exact-user-surface"
  },
  {
    "category": "configKeys",
    "id": "cesarMutateReflex",
    "source": "packages/core/src/models/types.ts:149",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-mutate",
    "rule": "semantic-source-rule"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/mutate",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-mutate",
    "rule": "exact-user-surface"
  }
]);
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runMutate, generateMutants } from './implementation.js';
