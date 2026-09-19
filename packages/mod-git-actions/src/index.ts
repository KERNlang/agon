import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.git-actions",
  "name": "Git Actions",
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
    "order": 503
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
      }
    ],
    "optional": [],
    "conflicts": []
  },
  "permissions": [
    {
      "capability": "git.write",
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
      "contentHash": "sha256:d850c74dfc246e3178f4f065c663321755dda42451e9e5b665adf26829f4ee5d",
      "bytes": 1703,
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
      "contentHash": "sha256:89aac656345d232570e8a6233af760ea249be5b714de7c481b94405c0ab2776b",
      "bytes": 228,
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
        "id": "intentVariants:0017",
        "aliases": []
      },
      {
        "id": "intentVariants:0064",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0013",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0049",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0018",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0070",
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
    "id": "commit",
    "source": "packages/core/src/blocks/builtin-commands.ts:31",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-git-actions",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "undo",
    "source": "packages/core/src/blocks/builtin-commands.ts:33",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-git-actions",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "commit",
    "source": "packages/cli/src/signals/intent-types.ts:45",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-git-actions",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "undo",
    "source": "packages/cli/src/signals/intent-types.ts:46",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-git-actions",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/commit",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-git-actions",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/undo",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-git-actions",
    "rule": "exact-user-surface"
  }
]);
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runGitAction } from './implementation.js';
