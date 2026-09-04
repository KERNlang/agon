import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.review",
  "name": "Review",
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
    "order": 200
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
      "contentHash": "sha256:a8569f0569a53af69c1d519d678bfb7048a1f424d813245298110a2e884345c8",
      "bytes": 4492,
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
      "contentHash": "sha256:e0ff6a2a0e8b76240883b4118c88e0798af3f82e709e36a54e62e0149837c146",
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
        "id": "cliCommands:0063",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0051",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0040",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0057",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0058",
        "aliases": []
      }
    ],
    "mcpTools": [
      {
        "id": "mcpTools:0021",
        "aliases": []
      }
    ],
    "cesarTools": [
      {
        "id": "cesarTools:0023",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0042",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0043",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0044",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0045",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0046",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0047",
        "aliases": []
      }
    ],
    "lifecycleHooks": [],
    "resultTypes": [
      {
        "id": "resultAndEnvelopeTypes:0107",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0108",
        "aliases": []
      }
    ],
    "configKeys": [
      {
        "id": "configKeys:0007",
        "aliases": []
      },
      {
        "id": "configKeys:0087",
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
    "category": "builtinCommandMetadata",
    "id": "review",
    "source": "packages/core/src/blocks/builtin-commands.ts:28",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "review",
    "source": "packages/cli/src/cesar/routing.ts:17",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "review",
    "source": "packages/cli/src/cesar/routing.ts:19",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "review",
    "source": "packages/cli/src/cesar/routing.ts:25",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "review",
    "source": "packages/cli/src/cesar/routing.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "review",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "review",
    "source": "packages/core/src/cesar/plan.ts:52",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "Review",
    "source": "packages/cli/src/cesar/tools.ts:45",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "semantic-source-rule"
  },
  {
    "category": "cliCommands",
    "id": "review",
    "source": "packages/cli/src/lazy-commands.ts:305",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "configKeys",
    "id": "autoReviewAfterImpl",
    "source": "packages/core/src/models/types.ts:176",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "semantic-source-rule"
  },
  {
    "category": "configKeys",
    "id": "goalReviewEngines",
    "source": "packages/core/src/models/types.ts:75",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "semantic-source-rule"
  },
  {
    "category": "intentVariants",
    "id": "review",
    "source": "packages/cli/src/signals/intent-types.ts:42",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "Review",
    "source": "packages/mcp/src/agon-orchestration.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "ReviewCoreResult",
    "source": "packages/cli/src/handlers/review.ts:332",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "ReviewEvent",
    "source": "packages/cli/src/blocks/controls.tsx:36",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "semantic-source-rule"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/review",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/review role",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-review",
    "rule": "exact-user-surface"
  }
]);
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runReview } from './implementation.js';
