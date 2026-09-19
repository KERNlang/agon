import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.rag",
  "name": "Rag",
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
    "group": "Knowledge",
    "order": 301
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
        "id": "agon.dedup",
        "range": ">=0.0.0-0"
      }
    ],
    "optional": [],
    "conflicts": []
  },
  "permissions": [
    {
      "capability": "fs.write",
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
      "contentHash": "sha256:503b6fe74606dbd0a417180241887ef51ef80ffd9fb934b3ad552a303489f9e2",
      "bytes": 1649,
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
      "contentHash": "sha256:83bf8b9a0aac203a73204aff0523793b1325401916ae375df366a7a6fc3e9816",
      "bytes": 212,
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
        "id": "cliCommands:0059",
        "aliases": []
      }
    ],
    "tuiActions": [],
    "mcpTools": [
      {
        "id": "mcpTools:0017",
        "aliases": []
      }
    ],
    "cesarTools": [],
    "lifecycleHooks": [],
    "resultTypes": [
      {
        "id": "resultAndEnvelopeTypes:0102",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0103",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0104",
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
      "dist/store.d.ts",
      "dist/types.d.ts",
      "dist/grounding.d.ts",
      "ownership.json",
      "schemas/config.schema.json"
    ],
    "executable": []
  }
});
export const SOURCE_OCCURRENCES = Object.freeze([
  {
    "category": "cliCommands",
    "id": "rag",
    "source": "packages/cli/src/lazy-commands.ts:317",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rag",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "ProjectContext",
    "source": "packages/mcp/src/project-context.ts:4",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rag",
    "rule": "exact-user-surface"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "RagEmbedResult",
    "source": "packages/core/src/rag/embed.ts:15",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rag",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "RagIndexResult",
    "source": "packages/mod-rag/src/types.ts:36",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rag",
    "rule": "physical-mod-owner"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "RagQueryResult",
    "source": "packages/mod-rag/src/types.ts:44",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rag",
    "rule": "physical-mod-owner"
  },
  {
    "category": "stateStoreModules",
    "id": "packages/mod-rag/src/store.ts",
    "source": "packages/mod-rag/src/store.ts",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-rag",
    "rule": "physical-mod-owner"
  }
]);
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export * from './store.js';
export * from './grounding.js';
export type * from './types.js';
export { runRag, buildRagIndex, queryRag, collectCorpusFiles, chunkMarkdown } from './implementation.js';
