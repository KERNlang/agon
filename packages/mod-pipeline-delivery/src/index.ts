import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.pipeline-delivery",
  "name": "Pipeline Delivery",
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
    "order": 107
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
        "id": "agon.agent",
        "range": ">=0.0.0-0"
      },
      {
        "id": "agon.review",
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
      "contentHash": "sha256:feb261054a0c710313b61fa67ec11e47d28df8f393eb702251c2c119797aaf24",
      "bytes": 1751,
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
      "contentHash": "sha256:dcdb9772a41b79669b857ccf7f7c2482e74fd0e0bbbf4e19e6443fcdfef83125",
      "bytes": 240,
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
        "id": "intentVariants:0045",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0034",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0050",
        "aliases": []
      }
    ],
    "mcpTools": [],
    "cesarTools": [
      {
        "id": "cesarTools:0016",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0036",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0037",
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
    "id": "pipeline",
    "source": "packages/core/src/blocks/builtin-commands.ts:29",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-pipeline-delivery",
    "rule": "pipeline-surface-split"
  },
  {
    "category": "cesarRoutes",
    "id": "pipeline",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-pipeline-delivery",
    "rule": "pipeline-surface-split"
  },
  {
    "category": "cesarRoutes",
    "id": "pipeline",
    "source": "packages/core/src/cesar/plan.ts:52",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-pipeline-delivery",
    "rule": "pipeline-surface-split"
  },
  {
    "category": "cesarTools",
    "id": "Pipeline",
    "source": "packages/cli/src/cesar/tools.ts:42",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-pipeline-delivery",
    "rule": "pipeline-surface-split"
  },
  {
    "category": "intentVariants",
    "id": "pipeline",
    "source": "packages/cli/src/signals/intent-types.ts:41",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-pipeline-delivery",
    "rule": "pipeline-surface-split"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/pipeline",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-pipeline-delivery",
    "rule": "pipeline-surface-split"
  }
]);
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
