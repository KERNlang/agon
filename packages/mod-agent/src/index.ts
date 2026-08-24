import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.agent",
  "name": "Agent",
  "version": "0.0.0-slice.5",
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
      "contentHash": "sha256:0d40774f1238aa730fee8f415566ff6fc9c9237b559bab864f466a069f12ba60",
      "bytes": 10122,
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
      },
      {
        "id": "cesarTools:0000",
        "aliases": []
      },
      {
        "id": "cesarTools:0006",
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
    "generatedDocs": [
      {
        "id": "generatedDocumentation:0000",
        "aliases": []
      }
    ]
  },
  "pack": {
    "include": [
      "agon.mod.json",
      "dist/index.js",
      "dist/index.d.ts",
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
    "category": "generatedDocumentation",
    "id": "AGENTS.md routing block",
    "source": "packages/cli/src/commands/agent-guide-text.ts:1",
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
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cesarRoutes:0000",
    "publicId": "agent",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/models/handler-types.ts:113"
  },
  {
    "id": "cesarRoutes:0001",
    "publicId": "agent",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/core/src/cesar/plan.ts:52"
  },
  {
    "id": "cesarRoutes:0009",
    "publicId": "bug-fix",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:27"
  },
  {
    "id": "cesarRoutes:0018",
    "publicId": "delegate",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:19"
  },
  {
    "id": "cesarRoutes:0019",
    "publicId": "delegate",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/models/handler-types.ts:113"
  },
  {
    "id": "cesarRoutes:0020",
    "publicId": "delegate",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/core/src/cesar/plan.ts:52"
  },
  {
    "id": "cesarRoutes:0040",
    "publicId": "quick-fix",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:25"
  },
  {
    "id": "cesarRoutes:0041",
    "publicId": "quick-fix",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:27"
  },
  {
    "id": "cesarRoutes:0059",
    "publicId": "team-agent",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/models/handler-types.ts:113"
  },
  {
    "id": "cesarRoutes:0060",
    "publicId": "team-agent",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/core/src/cesar/plan.ts:52"
  },
  {
    "id": "cesarTools:0000",
    "publicId": "Agent",
    "registryKind": "cesar-tool",
    "category": "cesarTools",
    "source": "packages/cli/src/cesar/tools.ts:47"
  },
  {
    "id": "cesarTools:0006",
    "publicId": "Delegate",
    "registryKind": "cesar-tool",
    "category": "cesarTools",
    "source": "packages/cli/src/cesar/tools.ts:46"
  },
  {
    "id": "configKeys:0012",
    "publicId": "cesarAgenticContinuationLimit",
    "registryKind": "config",
    "category": "configKeys",
    "source": "packages/core/src/models/types.ts:131"
  },
  {
    "id": "generatedDocumentation:0000",
    "publicId": "AGENTS.md routing block",
    "registryKind": "docs",
    "category": "generatedDocumentation",
    "source": "packages/cli/src/commands/agent-guide-text.ts:1"
  },
  {
    "id": "intentVariants:0000",
    "publicId": "agent",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:37"
  },
  {
    "id": "intentVariants:0001",
    "publicId": "agent-solo",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:38"
  },
  {
    "id": "intentVariants:0006",
    "publicId": "build",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:36"
  },
  {
    "id": "intentVariants:0054",
    "publicId": "speculate",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:39"
  },
  {
    "id": "intentVariants:0058",
    "publicId": "team-agent",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:40"
  },
  {
    "id": "mcpTools:0000",
    "publicId": "Agent",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/agon-orchestration.ts:24"
  },
  {
    "id": "mcpTools:0006",
    "publicId": "Delegate",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/agon-orchestration.ts:24"
  },
  {
    "id": "resultAndEnvelopeTypes:0000",
    "publicId": "AgentContinuationResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/cli/src/handlers/agent.ts:26"
  },
  {
    "id": "resultAndEnvelopeTypes:0002",
    "publicId": "AgentEvent",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/models/agent-event.ts:8"
  },
  {
    "id": "resultAndEnvelopeTypes:0004",
    "publicId": "AgenticTaskSnapshot",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/cli/src/cesar/task-controller.ts:11"
  },
  {
    "id": "resultAndEnvelopeTypes:0006",
    "publicId": "AgentProgressSnapshot",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/cli/src/signals/output.ts:20"
  },
  {
    "id": "resultAndEnvelopeTypes:0007",
    "publicId": "AgentSession",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/cesar/agent-session.ts:11"
  },
  {
    "id": "resultAndEnvelopeTypes:0011",
    "publicId": "AgentTeamMemberResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/cesar/agent-team.ts:80"
  },
  {
    "id": "resultAndEnvelopeTypes:0012",
    "publicId": "AgentTeamResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/cesar/agent-team.ts:90"
  },
  {
    "id": "builtinCommandMetadata:0000",
    "publicId": "agent",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:24"
  },
  {
    "id": "builtinCommandMetadata:0001",
    "publicId": "agent-solo",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:25"
  },
  {
    "id": "builtinCommandMetadata:0007",
    "publicId": "build",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:23"
  },
  {
    "id": "builtinCommandMetadata:0042",
    "publicId": "speculate",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:27"
  },
  {
    "id": "builtinCommandMetadata:0043",
    "publicId": "team-agent",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:26"
  },
  {
    "id": "tuiSlashCommands:0000",
    "publicId": "/agent",
    "registryKind": "tui-action",
    "category": "tuiSlashCommands",
    "source": "packages/cli/src/signals/intent.ts:56"
  },
  {
    "id": "tuiSlashCommands:0001",
    "publicId": "/agent-solo",
    "registryKind": "tui-action",
    "category": "tuiSlashCommands",
    "source": "packages/cli/src/signals/intent.ts:56"
  },
  {
    "id": "tuiSlashCommands:0007",
    "publicId": "/build",
    "registryKind": "tui-action",
    "category": "tuiSlashCommands",
    "source": "packages/cli/src/signals/intent.ts:56"
  },
  {
    "id": "tuiSlashCommands:0061",
    "publicId": "/speculate",
    "registryKind": "tui-action",
    "category": "tuiSlashCommands",
    "source": "packages/cli/src/signals/intent.ts:56"
  }
]);

export interface FirstPartyCompatibilityRuntime {
  command(kind: string, id: string, input: Json, context: InvocationContext): InvocationOutput;
  tool(kind: string, id: string, input: Json, context: InvocationContext): Awaitable<Json>;
  parseIntent(id: string, input: string): Awaitable<Json | undefined>;
  lifecycle(id: string, payload: Json, context: InvocationContext): Awaitable<void>;
  render(id: string, payload: Json): Awaitable<{ readonly text: string; readonly markdown?: string }>;
}

type FirstPartyServices = ModServices & { readonly firstPartyCompatibility?: FirstPartyCompatibilityRuntime };
const inputSchema = Object.freeze({ type: 'object', additionalProperties: true }) as Readonly<Record<string, Json>>;
const resultSchema = Object.freeze({ type: 'object', additionalProperties: true }) as Readonly<Record<string, Json>>;

export function createFirstPartyCompatibilityMod(runtime: FirstPartyCompatibilityRuntime): AgonModV1 {
  return Object.freeze({
    apiVersion: '1' as const,
    async activate(registrar: Registrar): Promise<Dispose> {
      const disposers: Dispose[] = [];
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0000", description: "agent compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "agent", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0001", description: "agent compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "agent", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0009", description: "bug-fix compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "bug-fix", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0018", description: "delegate compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "delegate", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0019", description: "delegate compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "delegate", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0020", description: "delegate compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "delegate", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0040", description: "quick-fix compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "quick-fix", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0041", description: "quick-fix compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "quick-fix", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0059", description: "team-agent compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "team-agent", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0060", description: "team-agent compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "team-agent", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarTools:0000", description: "Agent compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "Agent", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarTools:0006", description: "Delegate compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "Delegate", input, context) }));
      disposers.push(registrar.config("configKeys:0012", inputSchema));
      disposers.push(registrar.docs({ id: "generatedDocumentation:0000", title: "AGENTS.md routing block compatibility contribution", markdown: "Compatibility documentation owned by @kernlang/agon-mod-agent." }));
      disposers.push(registrar.intent({ id: "intentVariants:0000", description: "agent compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("agent", input), run: (input, context) => runtime.command('intent', "agent", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0001", description: "agent-solo compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("agent-solo", input), run: (input, context) => runtime.command('intent', "agent-solo", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0006", description: "build compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("build", input), run: (input, context) => runtime.command('intent', "build", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0054", description: "speculate compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("speculate", input), run: (input, context) => runtime.command('intent', "speculate", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0058", description: "team-agent compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("team-agent", input), run: (input, context) => runtime.command('intent', "team-agent", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0000", description: "Agent compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "Agent", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0006", description: "Delegate compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "Delegate", input, context) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0000", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("AgentContinuationResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0002", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("AgentEvent", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0004", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("AgenticTaskSnapshot", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0006", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("AgentProgressSnapshot", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0007", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("AgentSession", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0011", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("AgentTeamMemberResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0012", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("AgentTeamResult", payload) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0000", description: "agent compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "agent", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0001", description: "agent-solo compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "agent-solo", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0007", description: "build compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "build", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0042", description: "speculate compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "speculate", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0043", description: "team-agent compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "team-agent", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0000", description: "/agent compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/agent", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0001", description: "/agent-solo compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/agent-solo", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0007", description: "/build compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/build", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0061", description: "/speculate compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/speculate", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-agent requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
