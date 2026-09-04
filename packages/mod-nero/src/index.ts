import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.nero",
  "name": "Nero",
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
    "group": "Review and decide",
    "order": 204
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
        "id": "agon.judge",
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
      "contentHash": "sha256:eda9732b119cad76e01299b0aa9c0a7ffd7f7e412b641dc8d636c0a75fe1d956",
      "bytes": 1619,
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
      "contentHash": "sha256:29f38f1f85e905742222d9f6f5fb92d31127c23cf291bfcb4c7c6242285ef9c8",
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
    "cliCommands": [
      {
        "id": "cliCommands:0056",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0042",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0033",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0047",
        "aliases": []
      }
    ],
    "mcpTools": [
      {
        "id": "mcpTools:0019",
        "aliases": []
      }
    ],
    "cesarTools": [
      {
        "id": "cesarTools:0018",
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
    "id": "nero",
    "source": "packages/core/src/blocks/builtin-commands.ts:67",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-nero",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "QuickNero",
    "source": "packages/cli/src/cesar/tools.ts:49",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-nero",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "nero",
    "source": "packages/cli/src/lazy-commands.ts:318",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-nero",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "nero",
    "source": "packages/cli/src/signals/intent-types.ts:53",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-nero",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "QuickNero",
    "source": "packages/mcp/src/agon-orchestration.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-nero",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/nero",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-nero",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cesarTools:0018",
    "publicId": "QuickNero",
    "registryKind": "cesar-tool",
    "category": "cesarTools",
    "source": "packages/cli/src/cesar/tools.ts:49"
  },
  {
    "id": "cliCommands:0056",
    "publicId": "nero",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:318"
  },
  {
    "id": "intentVariants:0042",
    "publicId": "nero",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:53"
  },
  {
    "id": "mcpTools:0019",
    "publicId": "QuickNero",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/agon-orchestration.ts:24"
  },
  {
    "id": "builtinCommandMetadata:0033",
    "publicId": "nero",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:67"
  },
  {
    "id": "tuiSlashCommands:0047",
    "publicId": "/nero",
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
const _resultSchema = Object.freeze({ type: 'object', additionalProperties: true }) as Readonly<Record<string, Json>>;

export function createFirstPartyCompatibilityMod(runtime: FirstPartyCompatibilityRuntime): AgonModV1 {
  return Object.freeze({
    apiVersion: '1' as const,
    async activate(registrar: Registrar): Promise<Dispose> {
      const disposers: Dispose[] = [];
      disposers.push(registrar.tool('cesar', { id: "cesarTools:0018", description: "QuickNero compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "QuickNero", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0056", description: "nero compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "nero", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0042", description: "nero compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("nero", input), run: (input, context) => runtime.command('intent', "nero", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0019", description: "QuickNero compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "QuickNero", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0033", description: "nero compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "nero", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0047", description: "/nero compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/nero", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-nero requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
