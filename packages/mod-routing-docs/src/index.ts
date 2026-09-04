import { validateManifest } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.routing-docs",
  "name": "Routing Docs",
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
    "group": "Interfaces",
    "order": 603
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
      "contentHash": "sha256:4fb46f55ceabfdcb84ed16f6ff2346145d7d3c231e45e707975f1ce1d0d80aac",
      "bytes": 1489,
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
      "contentHash": "sha256:7611c01cedb770faa3d96a796da6f65458ba6bdb8a9064ef1e68787af1a909b8",
      "bytes": 230,
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
        "id": "cliCommands:0000",
        "aliases": []
      },
      {
        "id": "cliCommands:0025",
        "aliases": []
      }
    ],
    "tuiActions": [],
    "mcpTools": [],
    "cesarTools": [],
    "lifecycleHooks": [],
    "resultTypes": [],
    "configKeys": [],
    "generatedDocs": [
      {
        "id": "generatedDocumentation:0000",
        "aliases": []
      },
      {
        "id": "generatedDocumentation:0001",
        "aliases": []
      },
      {
        "id": "generatedDocumentation:0002",
        "aliases": []
      }
    ]
  },
  "pack": {
    "include": [
      "LICENSE",
      "agon.mod.json",
      "dist/index.js",
      "dist/index.d.ts",
      "dist/implementation.d.ts",
      "dist/guide-content.d.ts",
      "ownership.json",
      "schemas/config.schema.json"
    ],
    "executable": []
  }
});
export const SOURCE_OCCURRENCES = Object.freeze([
  {
    "category": "cliCommands",
    "id": "agent-guide",
    "source": "packages/cli/src/lazy-commands.ts:311",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-routing-docs",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "install-agent-prompts",
    "source": "packages/cli/src/lazy-commands.ts:312",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-routing-docs",
    "rule": "exact-user-surface"
  },
  {
    "category": "generatedDocumentation",
    "id": "AGENTS.md routing block",
    "source": "packages/cli/src/commands/agent-guide-text.ts:1",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-routing-docs",
    "rule": "generated-docs-owner"
  },
  {
    "category": "generatedDocumentation",
    "id": "docs/modes.md",
    "source": "package.json:12",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-routing-docs",
    "rule": "generated-docs-owner"
  },
  {
    "category": "generatedDocumentation",
    "id": "installed agent prompts",
    "source": "packages/cli/src/commands/install-agent-prompts.ts:1",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-routing-docs",
    "rule": "generated-docs-owner"
  }
]);
export const IMPLEMENTATION_KIND = 'physical' as const;
export { createMod } from './implementation.js';
export { createMod as default } from './implementation.js';
export { runGuide } from './implementation.js';
export { agentGuideMarkdown, modeDocsMarkdown, renderModeDocsProjection, agonShim, codexSkillMarkdown, codexSkillOpenAiYaml } from './guide-content.js';
