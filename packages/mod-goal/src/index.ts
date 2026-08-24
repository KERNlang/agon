import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.goal",
  "name": "Goal",
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
    "order": 4
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
        "id": "agon.plan",
        "range": ">=0.0.0-0"
      },
      {
        "id": "agon.agent",
        "range": ">=0.0.0-0"
      },
      {
        "id": "agon.review",
        "range": ">=0.0.0-0"
      },
      {
        "id": "agon.jobs",
        "range": ">=0.0.0-0"
      },
      {
        "id": "agon.git-actions",
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
      "contentHash": "sha256:c917af40ede2b5e1490ea3104d11ba96fc8fcb722fe277e97ce923f4b0e5f603",
      "bytes": 1091,
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
      "contentHash": "sha256:470094919664d45d91ea4ba5788fabf7e9a37cf367d5a79ca1b1181a7d8d0392",
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
        "id": "cliCommands:0023",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "tuiSlashCommands:0034",
        "aliases": []
      }
    ],
    "mcpTools": [],
    "cesarTools": [
      {
        "id": "cesarRoutes:0031",
        "aliases": []
      },
      {
        "id": "cesarTools:0012",
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
    "id": "goal",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-goal",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "Goal",
    "source": "packages/cli/src/cesar/tools.ts:43",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-goal",
    "rule": "semantic-source-rule"
  },
  {
    "category": "cliCommands",
    "id": "goal",
    "source": "packages/cli/src/lazy-commands.ts:313",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-goal",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/goal",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-goal",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cesarRoutes:0031",
    "publicId": "goal",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/models/handler-types.ts:113"
  },
  {
    "id": "cesarTools:0012",
    "publicId": "Goal",
    "registryKind": "cesar-tool",
    "category": "cesarTools",
    "source": "packages/cli/src/cesar/tools.ts:43"
  },
  {
    "id": "cliCommands:0023",
    "publicId": "goal",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:313"
  },
  {
    "id": "tuiSlashCommands:0034",
    "publicId": "/goal",
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
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0031", description: "goal compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "goal", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarTools:0012", description: "Goal compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "Goal", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0023", description: "goal compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "goal", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0034", description: "/goal compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/goal", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-goal requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
