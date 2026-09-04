import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.plan",
  "name": "Plan",
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
    "group": "Work",
    "order": 2
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
      },
      {
        "id": "agon.verification",
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
      "contentHash": "sha256:aca789b4fa7c1c4742c0e9537e166af0ea5bd2ec4417dcc2041ad08a1e732d01",
      "bytes": 7881,
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
      "contentHash": "sha256:eac294624a9eb62070ade1a09fc902170b72c1fee0409851c16bf49b16632a6b",
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
        "id": "intentVariants:0003",
        "aliases": []
      },
      {
        "id": "intentVariants:0004",
        "aliases": []
      },
      {
        "id": "intentVariants:0008",
        "aliases": []
      },
      {
        "id": "intentVariants:0046",
        "aliases": []
      },
      {
        "id": "intentVariants:0047",
        "aliases": []
      },
      {
        "id": "intentVariants:0050",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0003",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0004",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0009",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0035",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0036",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0039",
        "aliases": []
      },
      {
        "id": "tuiKeyboardActions:0022",
        "aliases": []
      },
      {
        "id": "tuiKeyboardActions:0026",
        "aliases": []
      },
      {
        "id": "tuiKeyboardActions:0038",
        "aliases": []
      },
      {
        "id": "tuiKeyboardActions:0041",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0003",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0004",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0009",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0051",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0052",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0056",
        "aliases": []
      }
    ],
    "mcpTools": [
      {
        "id": "mcpTools:0008",
        "aliases": []
      },
      {
        "id": "mcpTools:0018",
        "aliases": []
      }
    ],
    "cesarTools": [
      {
        "id": "cesarTools:0009",
        "aliases": []
      },
      {
        "id": "cesarTools:0014",
        "aliases": []
      },
      {
        "id": "cesarTools:0017",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0038",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0039",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0056",
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
    "id": "approve",
    "source": "packages/core/src/blocks/builtin-commands.ts:39",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "auto",
    "source": "packages/core/src/blocks/builtin-commands.ts:37",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "cancel",
    "source": "packages/core/src/blocks/builtin-commands.ts:41",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "plan",
    "source": "packages/core/src/blocks/builtin-commands.ts:36",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "plans",
    "source": "packages/core/src/blocks/builtin-commands.ts:38",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "retry",
    "source": "packages/core/src/blocks/builtin-commands.ts:40",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "plan",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "plan-first",
    "source": "packages/cli/src/cesar/routing.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "spec-first",
    "source": "packages/cli/src/cesar/routing.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "ExitPlanMode",
    "source": "packages/cli/src/cesar/tools.ts:53",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "ListPlans",
    "source": "packages/cli/src/cesar/tools.ts:54",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "ProposePlan",
    "source": "packages/cli/src/cesar/tools.ts:52",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "approve",
    "source": "packages/cli/src/signals/intent-types.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "auto",
    "source": "packages/cli/src/signals/intent-types.ts:63",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "cancel",
    "source": "packages/cli/src/signals/intent-types.ts:26",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "plan",
    "source": "packages/cli/src/signals/intent-types.ts:22",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "plans",
    "source": "packages/cli/src/signals/intent-types.ts:23",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "retry",
    "source": "packages/cli/src/signals/intent-types.ts:25",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "ExitPlanMode",
    "source": "packages/mcp/src/agon-orchestration.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "ProposePlan",
    "source": "packages/mcp/src/agon-orchestration.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiKeyboardActions",
    "id": "movePlanApproval",
    "source": "packages/cli/src/signals/keyboard.ts:78",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiKeyboardActions",
    "id": "planControl",
    "source": "packages/cli/src/signals/keyboard.ts:77",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiKeyboardActions",
    "id": "togglePlanQueued",
    "source": "packages/cli/src/signals/keyboard.ts:46",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiKeyboardActions",
    "id": "unqueuePlan",
    "source": "packages/cli/src/signals/keyboard.ts:67",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/approve",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/auto",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/cancel",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/plan",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/plans",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/retry",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  }
]);
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { createPersistenceEnvelope, unwrapPersistenceEnvelope } from './implementation.js';
