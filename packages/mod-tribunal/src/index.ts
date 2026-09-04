import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.tribunal",
  "name": "Tribunal",
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
    "order": 201
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
      },
      {
        "id": "agon.judge",
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
      "contentHash": "sha256:def6b68f0a1d289d2602d89d86fa03032f686b96eb5f722ab0e2a6e5270b93c6",
      "bytes": 3234,
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
      "contentHash": "sha256:02686441e5bd4265ddfdecadc361300e2bb08d10141bd986b4be8bea58b4d104",
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
        "id": "cliCommands:0072",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0057",
        "aliases": []
      },
      {
        "id": "intentVariants:0063",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0048",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0069",
        "aliases": []
      }
    ],
    "mcpTools": [
      {
        "id": "mcpTools:0032",
        "aliases": []
      }
    ],
    "cesarTools": [
      {
        "id": "cesarTools:0026",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0066",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0067",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0068",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0069",
        "aliases": []
      }
    ],
    "lifecycleHooks": [],
    "resultTypes": [
      {
        "id": "resultAndEnvelopeTypes:0139",
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
    "id": "tribunal",
    "source": "packages/core/src/blocks/builtin-commands.ts:16",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "tribunal",
    "source": "packages/cli/src/cesar/routing.ts:19",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "tribunal",
    "source": "packages/cli/src/cesar/routing.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "tribunal",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "tribunal",
    "source": "packages/core/src/cesar/plan.ts:52",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "Tribunal",
    "source": "packages/cli/src/cesar/tools.ts:39",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "semantic-source-rule"
  },
  {
    "category": "cliCommands",
    "id": "tribunal",
    "source": "packages/cli/src/lazy-commands.ts:289",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "suggest-tribunal",
    "source": "packages/cli/src/signals/intent-types.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "tribunal",
    "source": "packages/cli/src/signals/intent-types.ts:4",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "Tribunal",
    "source": "packages/mcp/src/agon-orchestration.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "TribunalResult",
    "source": "packages/forge/src/tribunal.ts:28",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "semantic-source-rule"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/tribunal",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-tribunal",
    "rule": "exact-user-surface"
  }
]);
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runTribunal } from './implementation.js';
