import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.agent",
  "name": "Agent",
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
    "order": 3
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
        "id": "agon.agent-runtime",
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
      "contentHash": "sha256:aeb79bee1faf67185ea2c4c2b27718996d6e269dade341b85bdb8470aaadd0d4",
      "bytes": 9831,
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
      "contentHash": "sha256:e0c16143ae261e1e3c9cd43274777967a8cc4970d61161d98d09c251dd80152e",
      "bytes": 216,
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
        "id": "intentVariants:0000",
        "aliases": []
      },
      {
        "id": "intentVariants:0001",
        "aliases": []
      },
      {
        "id": "intentVariants:0006",
        "aliases": []
      },
      {
        "id": "intentVariants:0054",
        "aliases": []
      },
      {
        "id": "intentVariants:0058",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0000",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0001",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0007",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0042",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0043",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0000",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0001",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0007",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0061",
        "aliases": []
      }
    ],
    "mcpTools": [
      {
        "id": "mcpTools:0000",
        "aliases": []
      },
      {
        "id": "mcpTools:0006",
        "aliases": []
      }
    ],
    "cesarTools": [
      {
        "id": "cesarTools:0000",
        "aliases": []
      },
      {
        "id": "cesarTools:0006",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0000",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0001",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0009",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0018",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0019",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0020",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0040",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0041",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0059",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0060",
        "aliases": []
      }
    ],
    "lifecycleHooks": [],
    "resultTypes": [
      {
        "id": "resultAndEnvelopeTypes:0000",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0002",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0004",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0006",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0007",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0011",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0012",
        "aliases": []
      }
    ],
    "configKeys": [
      {
        "id": "configKeys:0012",
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
    "id": "agent",
    "source": "packages/core/src/blocks/builtin-commands.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "agent-solo",
    "source": "packages/core/src/blocks/builtin-commands.ts:25",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "build",
    "source": "packages/core/src/blocks/builtin-commands.ts:23",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "speculate",
    "source": "packages/core/src/blocks/builtin-commands.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "team-agent",
    "source": "packages/core/src/blocks/builtin-commands.ts:26",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "agent",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "agent",
    "source": "packages/core/src/cesar/plan.ts:52",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "bug-fix",
    "source": "packages/cli/src/cesar/routing.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "delegate",
    "source": "packages/cli/src/cesar/routing.ts:19",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "delegate",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "delegate",
    "source": "packages/core/src/cesar/plan.ts:52",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "quick-fix",
    "source": "packages/cli/src/cesar/routing.ts:25",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "quick-fix",
    "source": "packages/cli/src/cesar/routing.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "team-agent",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "team-agent",
    "source": "packages/core/src/cesar/plan.ts:52",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "Agent",
    "source": "packages/cli/src/cesar/tools.ts:47",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "semantic-source-rule"
  },
  {
    "category": "cesarTools",
    "id": "Delegate",
    "source": "packages/cli/src/cesar/tools.ts:46",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "configKeys",
    "id": "cesarAgenticContinuationLimit",
    "source": "packages/core/src/models/types.ts:131",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "semantic-source-rule"
  },
  {
    "category": "intentVariants",
    "id": "agent",
    "source": "packages/cli/src/signals/intent-types.ts:37",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "agent-solo",
    "source": "packages/cli/src/signals/intent-types.ts:38",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "build",
    "source": "packages/cli/src/signals/intent-types.ts:36",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "speculate",
    "source": "packages/cli/src/signals/intent-types.ts:39",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "team-agent",
    "source": "packages/cli/src/signals/intent-types.ts:40",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "Agent",
    "source": "packages/mcp/src/agon-orchestration.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "semantic-source-rule"
  },
  {
    "category": "mcpTools",
    "id": "Delegate",
    "source": "packages/mcp/src/agon-orchestration.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "AgentContinuationResult",
    "source": "packages/cli/src/handlers/agent.ts:26",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "AgentEvent",
    "source": "packages/core/src/models/agent-event.ts:8",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "AgentProgressSnapshot",
    "source": "packages/cli/src/signals/output.ts:20",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "AgentSession",
    "source": "packages/core/src/cesar/agent-session.ts:11",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "AgentTeamMemberResult",
    "source": "packages/core/src/cesar/agent-team.ts:80",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "AgentTeamResult",
    "source": "packages/core/src/cesar/agent-team.ts:90",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "AgenticTaskSnapshot",
    "source": "packages/cli/src/cesar/task-controller.ts:11",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "semantic-source-rule"
  },
  {
    "category": "statePaths",
    "id": ".agon/agent-worktrees",
    "source": "packages/core/src/blocks/git.ts:419",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "semantic-source-rule"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/agent",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/agent-solo",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/build",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/speculate",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-agent",
    "rule": "exact-user-surface"
  }
]);
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runAgentTask } from './implementation.js';
