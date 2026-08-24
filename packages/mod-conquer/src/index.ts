import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.conquer",
  "name": "Conquer",
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
    "order": 5
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
        "id": "agon.nero",
        "range": ">=0.0.0-0"
      },
      {
        "id": "agon.tribunal",
        "range": ">=0.0.0-0"
      },
      {
        "id": "agon.council",
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
      "contentHash": "sha256:1cefebed5cdc48123c588f5c2cf81bfc6c1f5f694bf243a3b471ed47231456b7",
      "bytes": 1118,
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
      "contentHash": "sha256:c38de1f53d3c0a2aec3a35e35c95f2c6c0bca7409dfb62dc6530b7cff4a6a70b",
      "bytes": 220,
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
        "id": "cliCommands:0013",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "tuiSlashCommands:0021",
        "aliases": []
      }
    ],
    "mcpTools": [],
    "cesarTools": [
      {
        "id": "cesarRoutes:0016",
        "aliases": []
      },
      {
        "id": "cesarTools:0004",
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
    "category": "cesarRoutes",
    "id": "conquer",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-conquer",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "Conquer",
    "source": "packages/cli/src/cesar/tools.ts:44",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-conquer",
    "rule": "semantic-source-rule"
  },
  {
    "category": "cliCommands",
    "id": "conquer",
    "source": "packages/cli/src/lazy-commands.ts:321",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-conquer",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/conquer",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-conquer",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cesarRoutes:0016",
    "publicId": "conquer",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/models/handler-types.ts:113"
  },
  {
    "id": "cesarTools:0004",
    "publicId": "Conquer",
    "registryKind": "cesar-tool",
    "category": "cesarTools",
    "source": "packages/cli/src/cesar/tools.ts:44"
  },
  {
    "id": "cliCommands:0013",
    "publicId": "conquer",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:321"
  },
  {
    "id": "tuiSlashCommands:0021",
    "publicId": "/conquer",
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
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0016", description: "conquer compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "conquer", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarTools:0004", description: "Conquer compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "Conquer", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0013", description: "conquer compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "conquer", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0021", description: "/conquer compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/conquer", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-conquer requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
