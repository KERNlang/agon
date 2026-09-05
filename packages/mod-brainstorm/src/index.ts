import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.brainstorm",
  "name": "Brainstorm",
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
    "order": 100
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
        "id": "agon.dedup",
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
      "contentHash": "sha256:d3e81afaba7529c84d91023068f20a4fd1b80f4ff0c68403e353344df410b15d",
      "bytes": 3288,
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
      "contentHash": "sha256:9b320d8b5bee1302d0a6c17a761025f8bd80173267ec0ef68d31e4c17199d059",
      "bytes": 226,
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
        "id": "cliCommands:0003",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0005",
        "aliases": []
      },
      {
        "id": "intentVariants:0055",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0005",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0005",
        "aliases": []
      }
    ],
    "mcpTools": [
      {
        "id": "mcpTools:0004",
        "aliases": []
      }
    ],
    "cesarTools": [
      {
        "id": "cesarTools:0002",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0004",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0005",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0006",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0007",
        "aliases": []
      }
    ],
    "lifecycleHooks": [],
    "resultTypes": [
      {
        "id": "resultAndEnvelopeTypes:0019",
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
    "id": "brainstorm",
    "source": "packages/core/src/blocks/builtin-commands.ts:15",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "brainstorm",
    "source": "packages/cli/src/cesar/routing.ts:19",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "brainstorm",
    "source": "packages/cli/src/cesar/routing.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "brainstorm",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "brainstorm",
    "source": "packages/core/src/cesar/plan.ts:52",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "Brainstorm",
    "source": "packages/cli/src/cesar/tools.ts:38",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "semantic-source-rule"
  },
  {
    "category": "cliCommands",
    "id": "brainstorm",
    "source": "packages/cli/src/lazy-commands.ts:288",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "brainstorm",
    "source": "packages/cli/src/signals/intent-types.ts:3",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "suggest-brainstorm",
    "source": "packages/cli/src/signals/intent-types.ts:55",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "Brainstorm",
    "source": "packages/mcp/src/agon-orchestration.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "BrainstormResult",
    "source": "packages/core/src/models/types.ts:531",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "semantic-source-rule"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/brainstorm",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-brainstorm",
    "rule": "exact-user-surface"
  }
]);
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runBrainstorm } from './implementation.js';
export { createBrainstormWorkflow } from './workflow.js';
export { createBrainstormScoring, structuralScore, scoutScore, assignStances, fallbackParse } from './policy.js';
export type { BrainstormRatingHistory, ScoutScoreInput } from './policy.js';
export type { BrainstormWorkflowOptions, BrainstormWorkflowServices, BrainstormDraft, BrainstormBid } from './workflow.js';
