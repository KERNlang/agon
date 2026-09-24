import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.history",
  "name": "History",
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
    "group": "Knowledge",
    "order": 303
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
      "contentHash": "sha256:9de22376fb7847ad9794b996c27de22e0b7a15f470187b1d0f204f571bba8342",
      "bytes": 1394,
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
      "contentHash": "sha256:8bf93d7ba57c9c898e4915f6e20a529514f4f64f02fe6e2b712420475630f0ad",
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
        "id": "cliCommands:0024",
        "aliases": []
      },
      {
        "id": "cliCommands:0033",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0035",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0027",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0037",
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
    "id": "history",
    "source": "packages/core/src/blocks/builtin-commands.ts:55",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-history",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "history",
    "source": "packages/cli/src/lazy-commands.ts:295",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-history",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "last",
    "source": "packages/cli/src/lazy-commands.ts:301",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-history",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "history",
    "source": "packages/cli/src/signals/intent-types.ts:11",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-history",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/history",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-history",
    "rule": "exact-user-surface"
  }
]);
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runHistory } from './implementation.js';
