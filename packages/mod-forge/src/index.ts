import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.forge",
  "name": "Forge",
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
        "id": "cesarTools:0010",
        "aliases": []
      },
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
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runForgeCompetition } from './implementation.js';
