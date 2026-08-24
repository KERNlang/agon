import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.forge",
  "name": "Forge",
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
    "group": "Create and compete",
    "order": 103
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
      },
      {
        "id": "agon.worktree",
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
      "contentHash": "sha256:bccd98b182197875903a5646147d152d2b999cf20ffb3f64c476e4e7284d53bf",
      "bytes": 13623,
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
      "contentHash": "sha256:50007a043fe06fc2ba8693b82dbb6de9c1048141bbe55e9a6f7aa47b7d6bc974",
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
    "cliCommands": [
      {
        "id": "cliCommands:0022",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0002",
        "aliases": []
      },
      {
        "id": "intentVariants:0032",
        "aliases": []
      },
      {
        "id": "intentVariants:0056",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0002",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0025",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0002",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0033",
        "aliases": []
      }
    ],
    "mcpTools": [
      {
        "id": "mcpTools:0009",
        "aliases": []
      }
    ],
    "cesarTools": [
      {
        "id": "cesarRoutes:0023",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0024",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0025",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0026",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0027",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0028",
        "aliases": []
      },
      {
        "id": "cesarTools:0010",
        "aliases": []
      }
    ],
    "lifecycleHooks": [],
    "resultTypes": [
      {
        "id": "resultAndEnvelopeTypes:0016",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0022",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0037",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0038",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0039",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0043",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0055",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0056",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0058",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0060",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0063",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0064",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0083",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0085",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0086",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0095",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0098",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0106",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0114",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0120",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0124",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0126",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0127",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0128",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0133",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0144",
        "aliases": []
      }
    ],
    "configKeys": [
      {
        "id": "configKeys:0006",
        "aliases": []
      },
      {
        "id": "configKeys:0072",
        "aliases": []
      }
    ],
    "generatedDocs": []
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
    "id": "apply",
    "source": "packages/core/src/blocks/builtin-commands.ts:32",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "forge",
    "source": "packages/core/src/blocks/builtin-commands.ts:14",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "forge",
    "source": "packages/cli/src/cesar/routing.ts:19",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "forge",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "forge",
    "source": "packages/core/src/cesar/plan.ts:52",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "forge-full",
    "source": "packages/cli/src/cesar/routing.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "forge-slice",
    "source": "packages/cli/src/cesar/routing.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "forge-slice",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "Forge",
    "source": "packages/cli/src/cesar/tools.ts:37",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "cliCommands",
    "id": "forge",
    "source": "packages/cli/src/lazy-commands.ts:287",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "configKeys",
    "id": "autoReviewAfterForge",
    "source": "packages/core/src/models/types.ts:175",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "configKeys",
    "id": "forgeFitnessTimeout",
    "source": "packages/core/src/models/types.ts:79",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "emittedEvents",
    "id": "oracle-gameable",
    "source": "packages/forge/src/goal/oracle-probe.ts:62",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "emittedEvents",
    "id": "oracle-gate-error",
    "source": "packages/forge/src/goal/oracle-probe.ts:54",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "emittedEvents",
    "id": "oracle-gate-holes",
    "source": "packages/forge/src/goal/oracle-probe.ts:64",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "emittedEvents",
    "id": "oracle-gate-ok",
    "source": "packages/forge/src/goal/oracle-probe.ts:70",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "emittedEvents",
    "id": "oracle-gate-start",
    "source": "packages/forge/src/goal/oracle-probe.ts:19",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "intentVariants",
    "id": "apply",
    "source": "packages/cli/src/signals/intent-types.ts:31",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "forge",
    "source": "packages/cli/src/signals/intent-types.ts:2",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "suggest-forge",
    "source": "packages/cli/src/signals/intent-types.ts:57",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "Forge",
    "source": "packages/mcp/src/agon-orchestration.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "AttemptRecord",
    "source": "packages/forge/src/goal/types.ts:20",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "CampfireResult",
    "source": "packages/forge/src/campfire.ts:7",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "ConquerResult",
    "source": "packages/forge/src/conquer.ts:146",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "CorpusRecord",
    "source": "packages/forge/src/corpus.ts:9",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "CouncilResult",
    "source": "packages/forge/src/council.ts:36",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "DelegateResult",
    "source": "packages/forge/src/delegate.ts:5",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "FalsifierResult",
    "source": "packages/forge/src/conquer.ts:314",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "FileSnapshot",
    "source": "packages/core/src/forge/virtual-fs.ts:32",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "FitnessResult",
    "source": "packages/core/src/models/types.ts:9",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "ForgeEvent",
    "source": "packages/core/src/models/types.ts:451",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "GauntletResult",
    "source": "packages/core/src/models/types.ts:551",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "GoalEvent",
    "source": "packages/forge/src/goal/types.ts:48",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "MutateResult",
    "source": "packages/forge/src/mutate.ts:48",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "NaturalizeResult",
    "source": "packages/forge/src/naturalize.ts:18",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "NeroResult",
    "source": "packages/forge/src/nero.ts:28",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "PostSynthesisFitnessResult",
    "source": "packages/core/src/cesar/agent-synthesis.ts:486",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "PrTextResult",
    "source": "packages/forge/src/pr-text.ts:21",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "ResearchResult",
    "source": "packages/forge/src/research.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "SemanticMutantsResult",
    "source": "packages/forge/src/mutate-semantic.ts:25",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "StageResult",
    "source": "packages/forge/src/types-impl.ts:3",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "SyntaxCheckResult",
    "source": "packages/forge/src/quality.ts:49",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "SynthPlan",
    "source": "packages/forge/src/synth-plan.ts:16",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "SynthesisResult",
    "source": "packages/forge/src/synthesis-modus.ts:30",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "SynthesisResult",
    "source": "packages/forge/src/types-impl.ts:10",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "ThinkResult",
    "source": "packages/forge/src/thinking.ts:88",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "WitnessResult",
    "source": "packages/forge/src/goal/oracle.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "statePaths",
    "id": "goals/tmp",
    "source": "packages/forge/src/goal/oracle.ts:87",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "stateStoreModules",
    "id": "packages/forge/src/goal/journal.ts",
    "source": "packages/forge/src/goal/journal.ts",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "semantic-source-rule"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/apply",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/forge",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-forge",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cesarRoutes:0023",
    "publicId": "forge",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:19"
  },
  {
    "id": "cesarRoutes:0024",
    "publicId": "forge",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/models/handler-types.ts:113"
  },
  {
    "id": "cesarRoutes:0025",
    "publicId": "forge",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/core/src/cesar/plan.ts:52"
  },
  {
    "id": "cesarRoutes:0026",
    "publicId": "forge-full",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:27"
  },
  {
    "id": "cesarRoutes:0027",
    "publicId": "forge-slice",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:27"
  },
  {
    "id": "cesarRoutes:0028",
    "publicId": "forge-slice",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/models/handler-types.ts:113"
  },
  {
    "id": "cesarTools:0010",
    "publicId": "Forge",
    "registryKind": "cesar-tool",
    "category": "cesarTools",
    "source": "packages/cli/src/cesar/tools.ts:37"
  },
  {
    "id": "cliCommands:0022",
    "publicId": "forge",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:287"
  },
  {
    "id": "configKeys:0006",
    "publicId": "autoReviewAfterForge",
    "registryKind": "config",
    "category": "configKeys",
    "source": "packages/core/src/models/types.ts:175"
  },
  {
    "id": "configKeys:0072",
    "publicId": "forgeFitnessTimeout",
    "registryKind": "config",
    "category": "configKeys",
    "source": "packages/core/src/models/types.ts:79"
  },
  {
    "id": "intentVariants:0002",
    "publicId": "apply",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:31"
  },
  {
    "id": "intentVariants:0032",
    "publicId": "forge",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:2"
  },
  {
    "id": "intentVariants:0056",
    "publicId": "suggest-forge",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:57"
  },
  {
    "id": "mcpTools:0009",
    "publicId": "Forge",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/agon-orchestration.ts:24"
  },
  {
    "id": "resultAndEnvelopeTypes:0016",
    "publicId": "AttemptRecord",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/goal/types.ts:20"
  },
  {
    "id": "resultAndEnvelopeTypes:0022",
    "publicId": "CampfireResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/campfire.ts:7"
  },
  {
    "id": "resultAndEnvelopeTypes:0037",
    "publicId": "ConquerResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/conquer.ts:146"
  },
  {
    "id": "resultAndEnvelopeTypes:0038",
    "publicId": "CorpusRecord",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/corpus.ts:9"
  },
  {
    "id": "resultAndEnvelopeTypes:0039",
    "publicId": "CouncilResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/council.ts:36"
  },
  {
    "id": "resultAndEnvelopeTypes:0043",
    "publicId": "DelegateResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/delegate.ts:5"
  },
  {
    "id": "resultAndEnvelopeTypes:0055",
    "publicId": "FalsifierResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/conquer.ts:314"
  },
  {
    "id": "resultAndEnvelopeTypes:0056",
    "publicId": "FileSnapshot",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/forge/virtual-fs.ts:32"
  },
  {
    "id": "resultAndEnvelopeTypes:0058",
    "publicId": "FitnessResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/models/types.ts:9"
  },
  {
    "id": "resultAndEnvelopeTypes:0060",
    "publicId": "ForgeEvent",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/models/types.ts:451"
  },
  {
    "id": "resultAndEnvelopeTypes:0063",
    "publicId": "GauntletResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/models/types.ts:551"
  },
  {
    "id": "resultAndEnvelopeTypes:0064",
    "publicId": "GoalEvent",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/goal/types.ts:48"
  },
  {
    "id": "resultAndEnvelopeTypes:0083",
    "publicId": "MutateResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/mutate.ts:48"
  },
  {
    "id": "resultAndEnvelopeTypes:0085",
    "publicId": "NaturalizeResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/naturalize.ts:18"
  },
  {
    "id": "resultAndEnvelopeTypes:0086",
    "publicId": "NeroResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/nero.ts:28"
  },
  {
    "id": "resultAndEnvelopeTypes:0095",
    "publicId": "PostSynthesisFitnessResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/cesar/agent-synthesis.ts:486"
  },
  {
    "id": "resultAndEnvelopeTypes:0098",
    "publicId": "PrTextResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/pr-text.ts:21"
  },
  {
    "id": "resultAndEnvelopeTypes:0106",
    "publicId": "ResearchResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/research.ts:27"
  },
  {
    "id": "resultAndEnvelopeTypes:0114",
    "publicId": "SemanticMutantsResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/mutate-semantic.ts:25"
  },
  {
    "id": "resultAndEnvelopeTypes:0120",
    "publicId": "StageResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/types-impl.ts:3"
  },
  {
    "id": "resultAndEnvelopeTypes:0124",
    "publicId": "SyntaxCheckResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/quality.ts:49"
  },
  {
    "id": "resultAndEnvelopeTypes:0126",
    "publicId": "SynthesisResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/synthesis-modus.ts:30"
  },
  {
    "id": "resultAndEnvelopeTypes:0127",
    "publicId": "SynthesisResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/types-impl.ts:10"
  },
  {
    "id": "resultAndEnvelopeTypes:0128",
    "publicId": "SynthPlan",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/synth-plan.ts:16"
  },
  {
    "id": "resultAndEnvelopeTypes:0133",
    "publicId": "ThinkResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/thinking.ts:88"
  },
  {
    "id": "resultAndEnvelopeTypes:0144",
    "publicId": "WitnessResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/forge/src/goal/oracle.ts:24"
  },
  {
    "id": "builtinCommandMetadata:0002",
    "publicId": "apply",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:32"
  },
  {
    "id": "builtinCommandMetadata:0025",
    "publicId": "forge",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:14"
  },
  {
    "id": "tuiSlashCommands:0002",
    "publicId": "/apply",
    "registryKind": "tui-action",
    "category": "tuiSlashCommands",
    "source": "packages/cli/src/signals/intent.ts:56"
  },
  {
    "id": "tuiSlashCommands:0033",
    "publicId": "/forge",
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
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0023", description: "forge compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "forge", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0024", description: "forge compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "forge", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0025", description: "forge compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "forge", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0026", description: "forge-full compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "forge-full", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0027", description: "forge-slice compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "forge-slice", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0028", description: "forge-slice compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "forge-slice", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarTools:0010", description: "Forge compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "Forge", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0022", description: "forge compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "forge", input, context) }));
      disposers.push(registrar.config("configKeys:0006", inputSchema));
      disposers.push(registrar.config("configKeys:0072", inputSchema));
      disposers.push(registrar.intent({ id: "intentVariants:0002", description: "apply compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("apply", input), run: (input, context) => runtime.command('intent', "apply", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0032", description: "forge compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("forge", input), run: (input, context) => runtime.command('intent', "forge", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0056", description: "suggest-forge compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("suggest-forge", input), run: (input, context) => runtime.command('intent', "suggest-forge", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0009", description: "Forge compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "Forge", input, context) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0016", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("AttemptRecord", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0022", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("CampfireResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0037", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("ConquerResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0038", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("CorpusRecord", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0039", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("CouncilResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0043", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("DelegateResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0055", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("FalsifierResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0056", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("FileSnapshot", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0058", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("FitnessResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0060", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("ForgeEvent", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0063", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("GauntletResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0064", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("GoalEvent", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0083", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("MutateResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0085", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("NaturalizeResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0086", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("NeroResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0095", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("PostSynthesisFitnessResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0098", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("PrTextResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0106", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("ResearchResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0114", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("SemanticMutantsResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0120", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("StageResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0124", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("SyntaxCheckResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0126", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("SynthesisResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0127", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("SynthesisResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0128", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("SynthPlan", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0133", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("ThinkResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0144", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("WitnessResult", payload) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0002", description: "apply compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "apply", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0025", description: "forge compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "forge", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0002", description: "/apply compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/apply", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0033", description: "/forge compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/forge", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-forge requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
