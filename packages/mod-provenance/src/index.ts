import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.provenance",
  "name": "Provenance",
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
    "order": 304
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
      "contentHash": "sha256:ecfc0e69157008eb04c3e79a23e7dcd728a42257c3a71e0dcc3d6d475860208a",
      "bytes": 1231,
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
      "contentHash": "sha256:54661acb4f56e0699dfa9d3b84e4b1c16ccb1666644becce0abad7f7062c783a",
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
        "id": "cliCommands:0057",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "builtinCommandMetadata:0037",
        "aliases": []
      }
    ],
    "mcpTools": [],
    "cesarTools": [],
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
    "id": "provenance",
    "source": "packages/core/src/blocks/builtin-commands.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-provenance",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "provenance",
    "source": "packages/cli/src/lazy-commands.ts:298",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-provenance",
    "rule": "exact-user-surface"
  },
  {
    "category": "stateStoreModules",
    "id": "packages/cli/src/commands/provenance.ts",
    "source": "packages/cli/src/commands/provenance.ts",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-provenance",
    "rule": "semantic-source-rule"
  },
  {
    "category": "stateStoreModules",
    "id": "packages/core/src/blocks/provenance.ts",
    "source": "packages/core/src/blocks/provenance.ts",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-provenance",
    "rule": "semantic-source-rule"
  }
]);
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runProvenance, buildProvenance, renderMarkdown } from './implementation.js';
