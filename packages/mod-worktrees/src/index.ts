import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.worktrees",
  "name": "Worktrees",
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
    "group": "Collaborate and automate",
    "order": 502
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
        "id": "agon.worktree",
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
      "contentHash": "sha256:86c75c54c62df69d5681fc42777ac02a51bfc5a8bcd8af0944cb59b12cfde115",
      "bytes": 1946,
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
      "contentHash": "sha256:df8c3f21885db020d733b1379483da9d87fec292739fbe00c231f65425089060",
      "bytes": 224,
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
        "id": "cliCommands:0066",
        "aliases": []
      },
      {
        "id": "cliCommands:0067",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "intentVariants:0067",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0051",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0052",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0071",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0072",
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
    "category": "builtinCommandMetadata",
    "id": "workspace",
    "source": "packages/core/src/blocks/builtin-commands.ts:44",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-worktrees",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "worktree",
    "source": "packages/core/src/blocks/builtin-commands.ts:73",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-worktrees",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "worktree",
    "source": "packages/cli/src/lazy-commands.ts:322",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-worktrees",
    "rule": "exact-user-surface"
  },
  {
    "category": "cliCommands",
    "id": "wt",
    "source": "packages/cli/src/lazy-commands.ts:323",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-worktrees",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "workspace",
    "source": "packages/cli/src/signals/intent-types.ts:15",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-worktrees",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/workspace",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-worktrees",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/ws",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-worktrees",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cliCommands:0066",
    "publicId": "worktree",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:322"
  },
  {
    "id": "cliCommands:0067",
    "publicId": "wt",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:323"
  },
  {
    "id": "intentVariants:0067",
    "publicId": "workspace",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:15"
  },
  {
    "id": "builtinCommandMetadata:0051",
    "publicId": "workspace",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:44"
  },
  {
    "id": "builtinCommandMetadata:0052",
    "publicId": "worktree",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:73"
  },
  {
    "id": "tuiSlashCommands:0071",
    "publicId": "/workspace",
    "registryKind": "tui-action",
    "category": "tuiSlashCommands",
    "source": "packages/cli/src/signals/intent.ts:56"
  },
  {
    "id": "tuiSlashCommands:0072",
    "publicId": "/ws",
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
      disposers.push(registrar.command('cli', { id: "cliCommands:0066", description: "worktree compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "worktree", input, context) }));
      disposers.push(registrar.command('cli', { id: "cliCommands:0067", description: "wt compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "wt", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0067", description: "workspace compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("workspace", input), run: (input, context) => runtime.command('intent', "workspace", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0051", description: "workspace compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "workspace", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0052", description: "worktree compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "worktree", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0071", description: "/workspace compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/workspace", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0072", description: "/ws compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/ws", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-worktrees requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
