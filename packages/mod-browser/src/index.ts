import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.browser",
  "name": "Browser",
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
    "group": "Interfaces",
    "order": 600
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
        "id": "agon.browser-bridge",
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
      "contentHash": "sha256:650ee61f69d6f46f66d43fae7c7d0a5f82fc176116f9f4f15ce89b397121b7b1",
      "bytes": 4520,
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
      "contentHash": "sha256:af47aec834d77f2465d3f4be734fab57b1428e70b0b40dc518d37e9533c00d1b",
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
        "id": "cliCommands:0004",
        "aliases": []
      },
      {
        "id": "cliCommands:0005",
        "aliases": []
      },
      {
        "id": "cliCommands:0006",
        "aliases": []
      },
      {
        "id": "cliCommands:0007",
        "aliases": []
      },
      {
        "id": "cliCommands:0008",
        "aliases": []
      },
      {
        "id": "cliCommands:0011",
        "aliases": []
      },
      {
        "id": "cliCommands:0017",
        "aliases": []
      },
      {
        "id": "cliCommands:0019",
        "aliases": []
      },
      {
        "id": "cliCommands:0020",
        "aliases": []
      },
      {
        "id": "cliCommands:0021",
        "aliases": []
      },
      {
        "id": "cliCommands:0057",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "tuiSlashCommands:0015",
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
    "category": "cliCommands",
    "id": "browser-host",
    "source": "packages/cli/src/lazy-commands.ts:330",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-browser",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "browser-host install",
    "source": "packages/cli/src/commands/browser-host.ts:546",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-browser",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "browser-host status",
    "source": "packages/cli/src/commands/browser-host.ts:548",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-browser",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "browser-host stop",
    "source": "packages/cli/src/commands/browser-host.ts:549",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-browser",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "browser-host uninstall",
    "source": "packages/cli/src/commands/browser-host.ts:547",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-browser",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "chrome",
    "source": "packages/cli/src/lazy-commands.ts:328",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-browser",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "drive",
    "source": "packages/cli/src/lazy-commands.ts:327",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-browser",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "ext",
    "source": "packages/cli/src/lazy-commands.ts:329",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-browser",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "ext install",
    "source": "packages/cli/src/commands/ext.ts:321",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-browser",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "ext native-host",
    "source": "packages/cli/src/commands/ext.ts:322",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-browser",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "serve",
    "source": "packages/cli/src/lazy-commands.ts:326",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-browser",
    "rule": "exact-user-surface"
  },
  {
    "category": "statePaths",
    "id": "browser-host",
    "source": "packages/cli/src/commands/browser-host.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-browser",
    "rule": "exact-user-surface"
  },
  {
    "category": "statePaths",
    "id": "serve",
    "source": "packages/cli/src/bridge/chrome-bridge.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-browser",
    "rule": "exact-user-surface"
  },
  {
    "category": "statePaths",
    "id": "serve",
    "source": "packages/cli/src/bridge/serve-runtime.ts:86",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-browser",
    "rule": "exact-user-surface"
  },
  {
    "category": "statePaths",
    "id": "serve",
    "source": "packages/cli/src/commands/browser-host.ts:41",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-browser",
    "rule": "exact-user-surface"
  },
  {
    "category": "statePaths",
    "id": "serve",
    "source": "packages/cli/src/commands/drive.ts:98",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-browser",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/chrome",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-browser",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cliCommands:0004",
    "publicId": "browser-host",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:330"
  },
  {
    "id": "cliCommands:0005",
    "publicId": "browser-host install",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/commands/browser-host.ts:546"
  },
  {
    "id": "cliCommands:0006",
    "publicId": "browser-host status",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/commands/browser-host.ts:548"
  },
  {
    "id": "cliCommands:0007",
    "publicId": "browser-host stop",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/commands/browser-host.ts:549"
  },
  {
    "id": "cliCommands:0008",
    "publicId": "browser-host uninstall",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/commands/browser-host.ts:547"
  },
  {
    "id": "cliCommands:0011",
    "publicId": "chrome",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:328"
  },
  {
    "id": "cliCommands:0017",
    "publicId": "drive",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:327"
  },
  {
    "id": "cliCommands:0019",
    "publicId": "ext",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:329"
  },
  {
    "id": "cliCommands:0020",
    "publicId": "ext install",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/commands/ext.ts:321"
  },
  {
    "id": "cliCommands:0021",
    "publicId": "ext native-host",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/commands/ext.ts:322"
  },
  {
    "id": "cliCommands:0057",
    "publicId": "serve",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:326"
  },
  {
    "id": "tuiSlashCommands:0015",
    "publicId": "/chrome",
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
      disposers.push(registrar.command('cli', { id: "cliCommands:0004", description: "browser-host compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "browser-host", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0005", description: "browser-host install compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "browser-host install", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0006", description: "browser-host status compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "browser-host status", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0007", description: "browser-host stop compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "browser-host stop", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0008", description: "browser-host uninstall compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "browser-host uninstall", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0011", description: "chrome compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "chrome", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0017", description: "drive compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "drive", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0019", description: "ext compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "ext", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0020", description: "ext install compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "ext install", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0021", description: "ext native-host compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "ext native-host", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0057", description: "serve compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "serve", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0015", description: "/chrome compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/chrome", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-browser requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
