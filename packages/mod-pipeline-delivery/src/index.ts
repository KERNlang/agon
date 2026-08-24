import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.pipeline-delivery",
  "name": "Pipeline Delivery",
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
      "contentHash": "sha256:f172afbbd1bae7c28757f046caa38d1f8823cda5489eb529f06c099458574894",
      "bytes": 1476,
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
      }
    ],
    "mcpTools": [],
    "cesarTools": [
      {
        "id": "cesarRoutes:0036",
        "aliases": []
      },
      {
        "id": "cesarRoutes:0037",
        "aliases": []
      },
      {
        "id": "cesarTools:0016",
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
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cesarRoutes:0036",
    "publicId": "pipeline",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/cli/src/models/handler-types.ts:113"
  },
  {
    "id": "cesarRoutes:0037",
    "publicId": "pipeline",
    "registryKind": "cesar-tool",
    "category": "cesarRoutes",
    "source": "packages/core/src/cesar/plan.ts:52"
  },
  {
    "id": "cesarTools:0016",
    "publicId": "Pipeline",
    "registryKind": "cesar-tool",
    "category": "cesarTools",
    "source": "packages/cli/src/cesar/tools.ts:42"
  },
  {
    "id": "intentVariants:0045",
    "publicId": "pipeline",
    "registryKind": "intent",
    "category": "intentVariants",
    "source": "packages/cli/src/signals/intent-types.ts:41"
  },
  {
    "id": "builtinCommandMetadata:0034",
    "publicId": "pipeline",
    "registryKind": "tui-action",
    "category": "builtinCommandMetadata",
    "source": "packages/core/src/blocks/builtin-commands.ts:29"
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
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0036", description: "pipeline compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "pipeline", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarRoutes:0037", description: "pipeline compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "pipeline", input, context) }));
      disposers.push(registrar.tool('cesar', { id: "cesarTools:0016", description: "Pipeline compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('cesar-tool', "Pipeline", input, context) }));
      disposers.push(registrar.intent({ id: "intentVariants:0045", description: "pipeline compatibility contribution", inputSchema, parse: (input) => runtime.parseIntent("pipeline", input), run: (input, context) => runtime.command('intent', "pipeline", input, context) }));
      disposers.push(registrar.command('tui', { id: "builtinCommandMetadata:0034", description: "pipeline compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "pipeline", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-pipeline-delivery requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
