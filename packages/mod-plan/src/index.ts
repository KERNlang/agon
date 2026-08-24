import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.plan",
  "name": "Plan",
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
    "order": 2
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
        "id": "agon.verification",
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
      "contentHash": "sha256:aca789b4fa7c1c4742c0e9537e166af0ea5bd2ec4417dcc2041ad08a1e732d01",
      "bytes": 7881,
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
      "contentHash": "sha256:eac294624a9eb62070ade1a09fc902170b72c1fee0409851c16bf49b16632a6b",
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
    "cliCommands": [],
    "tuiActions": [
      {
        "id": "intentVariants:0003",
        "aliases": []
      },
      {
        "id": "intentVariants:0004",
        "aliases": []
      },
      {
        "id": "intentVariants:0008",
        "aliases": []
      },
      {
        "id": "intentVariants:0046",
        "aliases": []
      },
      {
        "id": "intentVariants:0047",
        "aliases": []
      },
      {
        "id": "intentVariants:0050",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0003",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0004",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0009",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0035",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0036",
        "aliases": []
      },
      {
        "id": "builtinCommandMetadata:0039",
        "aliases": []
      },
      {
        "id": "tuiKeyboardActions:0022",
        "aliases": []
      },
      {
        "id": "tuiKeyboardActions:0026",
        "aliases": []
      },
      {
        "id": "tuiKeyboardActions:0038",
        "aliases": []
      },
      {
        "id": "tuiKeyboardActions:0041",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0003",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0004",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0009",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0051",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0052",
        "aliases": []
      },
      {
        "id": "tuiSlashCommands:0056",
        "aliases": []
      }
    ],
    "mcpTools": [
      {
        "id": "mcpTools:0008",
        "aliases": []
      },
      {
        "id": "mcpTools:0018",
        "aliases": []
      }
    ],
    "cesarTools": [
      {
        "id": "cesarRoutes:0038",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0039",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0056",
        "aliases": []
      },
      {
        "id": "cesarTools:0009",
        "aliases": []
      },
      {
        "id": "cesarTools:0014",
        "aliases": []
      },
      {
        "id": "cesarTools:0017",
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
    "id": "approve",
    "source": "packages/core/src/blocks/builtin-commands.ts:39",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "auto",
    "source": "packages/core/src/blocks/builtin-commands.ts:37",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "cancel",
    "source": "packages/core/src/blocks/builtin-commands.ts:41",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "plan",
    "source": "packages/core/src/blocks/builtin-commands.ts:36",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "plans",
    "source": "packages/core/src/blocks/builtin-commands.ts:38",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "builtinCommandMetadata",
    "id": "retry",
    "source": "packages/core/src/blocks/builtin-commands.ts:40",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "plan",
    "source": "packages/cli/src/models/handler-types.ts:113",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "plan-first",
    "source": "packages/cli/src/cesar/routing.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarRoutes",
    "id": "spec-first",
    "source": "packages/cli/src/cesar/routing.ts:27",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "ExitPlanMode",
    "source": "packages/cli/src/cesar/tools.ts:53",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "ListPlans",
    "source": "packages/cli/src/cesar/tools.ts:54",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "cesarTools",
    "id": "ProposePlan",
    "source": "packages/cli/src/cesar/tools.ts:52",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "approve",
    "source": "packages/cli/src/signals/intent-types.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "auto",
    "source": "packages/cli/src/signals/intent-types.ts:63",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "cancel",
    "source": "packages/cli/src/signals/intent-types.ts:26",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "plan",
    "source": "packages/cli/src/signals/intent-types.ts:22",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "plans",
    "source": "packages/cli/src/signals/intent-types.ts:23",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "intentVariants",
    "id": "retry",
    "source": "packages/cli/src/signals/intent-types.ts:25",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "ExitPlanMode",
    "source": "packages/mcp/src/agon-orchestration.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "mcpTools",
    "id": "ProposePlan",
    "source": "packages/mcp/src/agon-orchestration.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiKeyboardActions",
    "id": "movePlanApproval",
    "source": "packages/cli/src/signals/keyboard.ts:78",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiKeyboardActions",
    "id": "planControl",
    "source": "packages/cli/src/signals/keyboard.ts:77",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiKeyboardActions",
    "id": "togglePlanQueued",
    "source": "packages/cli/src/signals/keyboard.ts:46",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiKeyboardActions",
    "id": "unqueuePlan",
    "source": "packages/cli/src/signals/keyboard.ts:67",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/approve",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/auto",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/cancel",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/plan",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/plans",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/retry",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-plan",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cesarRoutes:0038",
    "publicId": "plan",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/models/handler-types.ts:113"
  },
  {
    "id": "cesarRoutes:0039",
    "publicId": "plan-first",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:27"
  },
  {
    "id": "cesarRoutes:0056",
    "publicId": "spec-first",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/cesar/routing.ts:27"
  },
  {
    "id": "cesarTools:0009",
    "publicId": "ExitPlanMode",
    "registryKind": "cesar-tool",
    "category": "cesarTools",
    "source": "packages/cli/src/cesar/tools.ts:53"
  },
  {
    "id": "cesarTools:0014",
    "publicId": "ListPlans",
    "registryKind": "cesar-tool",
    "category": "cesarTools",
    "source": "packages/cli/src/cesar/tools.ts:54"
  },
  {
    "id": "cesarTools:0017",
    "publicId": "ProposePlan",
    "registryKind": "cesar-tool",
    "category": "cesarTools",
    "source": "packages/cli/src/cesar/tools.ts:52"
  },
  {
    "id": "intentVariants:0003",
    "publicId": "approve",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:24"
  },
  {
    "id": "intentVariants:0004",
    "publicId": "auto",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:63"
  },
  {
    "id": "intentVariants:0008",
    "publicId": "cancel",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:26"
  },
  {
    "id": "intentVariants:0046",
    "publicId": "plan",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:22"
  },
  {
    "id": "intentVariants:0047",
    "publicId": "plans",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:23"
  },
  {
    "id": "intentVariants:0050",
    "publicId": "retry",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:25"
  },
  {
    "id": "mcpTools:0008",
    "publicId": "ExitPlanMode",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/agon-orchestration.ts:24"
  },
  {
    "id": "mcpTools:0018",
    "publicId": "ProposePlan",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/agon-orchestration.ts:24"
  },
  {
    "id": "builtinCommandMetadata:0003",
    "publicId": "approve",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:39"
  },
  {
    "id": "builtinCommandMetadata:0004",
    "publicId": "auto",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:37"
  },
  {
    "id": "builtinCommandMetadata:0009",
    "publicId": "cancel",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:41"
  },
  {
    "id": "builtinCommandMetadata:0035",
    "publicId": "plan",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:36"
  },
  {
    "id": "builtinCommandMetadata:0036",
    "publicId": "plans",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:38"
  },
  {
    "id": "builtinCommandMetadata:0039",
    "publicId": "retry",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:40"
  },
  {
    "id": "tuiKeyboardActions:0022",
    "publicId": "movePlanApproval",
    "registryKind": "tui-action",
    "category": "tuiKeyboardActions",
    "source": "packages/cli/src/signals/keyboard.ts:78"
  },
  {
    "id": "tuiKeyboardActions:0026",
    "publicId": "planControl",
    "registryKind": "tui-action",
    "category": "tuiKeyboardActions",
    "source": "packages/cli/src/signals/keyboard.ts:77"
  },
  {
    "id": "tuiKeyboardActions:0038",
    "publicId": "togglePlanQueued",
    "registryKind": "tui-action",
    "category": "tuiKeyboardActions",
    "source": "packages/cli/src/signals/keyboard.ts:46"
  },
  {
    "id": "tuiKeyboardActions:0041",
    "publicId": "unqueuePlan",
    "registryKind": "tui-action",
    "category": "tuiKeyboardActions",
    "source": "packages/cli/src/signals/keyboard.ts:67"
  },
  {
    "id": "tuiSlashCommands:0003",
    "publicId": "/approve",
    "registryKind": "tui-action",
    "category": "tuiSlashCommands",
    "source": "packages/cli/src/signals/intent.ts:56"
  },
  {
    "id": "tuiSlashCommands:0004",
    "publicId": "/auto",
    "registryKind": "tui-action",
    "category": "tuiSlashCommands",
    "source": "packages/cli/src/signals/intent.ts:56"
  },
  {
    "id": "tuiSlashCommands:0009",
    "publicId": "/cancel",
    "registryKind": "tui-action",
    "category": "tuiSlashCommands",
    "source": "packages/cli/src/signals/intent.ts:56"
  },
  {
    "id": "tuiSlashCommands:0051",
    "publicId": "/plan",
    "registryKind": "tui-action",
    "category": "tuiSlashCommands",
    "source": "packages/cli/src/signals/intent.ts:56"
  },
  {
    "id": "tuiSlashCommands:0052",
    "publicId": "/plans",
    "registryKind": "tui-action",
    "category": "tuiSlashCommands",
    "source": "packages/cli/src/signals/intent.ts:56"
  },
  {
    "id": "tuiSlashCommands:0056",
    "publicId": "/retry",
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
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0038", description: "plan compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "plan", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0039", description: "plan-first compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "plan-first", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0056", description: "spec-first compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "spec-first", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarTools:0009", description: "ExitPlanMode compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "ExitPlanMode", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarTools:0014", description: "ListPlans compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "ListPlans", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarTools:0017", description: "ProposePlan compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "ProposePlan", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0003", description: "approve compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("approve", input), run: (input, context) => runtime.command('intent', "approve", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0004", description: "auto compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("auto", input), run: (input, context) => runtime.command('intent', "auto", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0008", description: "cancel compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("cancel", input), run: (input, context) => runtime.command('intent', "cancel", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0046", description: "plan compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("plan", input), run: (input, context) => runtime.command('intent', "plan", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0047", description: "plans compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("plans", input), run: (input, context) => runtime.command('intent', "plans", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0050", description: "retry compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("retry", input), run: (input, context) => runtime.command('intent', "retry", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0008", description: "ExitPlanMode compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "ExitPlanMode", input, context) }));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0018", description: "ProposePlan compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "ProposePlan", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0003", description: "approve compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "approve", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0004", description: "auto compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "auto", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0009", description: "cancel compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "cancel", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0035", description: "plan compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "plan", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0036", description: "plans compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "plans", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0039", description: "retry compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "retry", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiKeyboardActions:0022", description: "movePlanApproval compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "movePlanApproval", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiKeyboardActions:0026", description: "planControl compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "planControl", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiKeyboardActions:0038", description: "togglePlanQueued compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "togglePlanQueued", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiKeyboardActions:0041", description: "unqueuePlan compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "unqueuePlan", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0003", description: "/approve compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/approve", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0004", description: "/auto compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/auto", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0009", description: "/cancel compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/cancel", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0051", description: "/plan compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/plan", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0052", description: "/plans compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/plans", input, context) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0056", description: "/retry compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/retry", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-plan requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
