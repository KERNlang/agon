import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.flow",
  "name": "Flow",
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
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runFlow } from './implementation.js';
