import { validateManifest } from '@kernlang/agon-mod-api';
import type { AgonModFactory, AgonModV1, Awaitable, Dispose, InvocationContext, InvocationOutput, Json, ModServices, Registrar } from '@kernlang/agon-mod-api';

export const MANIFEST = validateManifest({
  "schemaVersion": 2,
  "id": "agon.synthesis",
  "name": "Synthesis",
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
    "order": 105
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
        "id": "agon.panel",
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
      "contentHash": "sha256:88915974e5fbd4f824bb4cbc51c45e73d14d65850f9ee7a9da28614e37059750",
      "bytes": 2280,
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
      "contentHash": "sha256:7052783e2fb284beae69acbe4c7d6a47088de0b85166c2db6b85adc1e378c515",
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
        "id": "cliCommands:0067",
        "aliases": []
      }
    ],
    "tuiActions": [
      {
        "id": "tuiSlashCommands:0063",
        "aliases": []
      }
    ],
    "mcpTools": [
      {
        "id": "mcpTools:0031",
        "aliases": []
      }
    ],
    "cesarTools": [],
    "lifecycleHooks": [],
    "resultTypes": [
      {
        "id": "resultAndEnvelopeTypes:0005",
        "aliases": []
      },
      {
        "id": "resultAndEnvelopeTypes:0010",
        "aliases": []
      }
    ],
    "configKeys": [
      {
        "id": "configKeys:0071",
        "aliases": []
      },
      {
        "id": "configKeys:0082",
        "aliases": []
      },
      {
        "id": "configKeys:0113",
        "aliases": []
      }
    ],
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
    "id": "synthesis",
    "source": "packages/cli/src/lazy-commands.ts:314",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-synthesis",
    "rule": "exact-user-surface"
  },
  {
    "category": "configKeys",
    "id": "forgeEnableSynthesis",
    "source": "packages/core/src/models/types.ts:70",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-synthesis",
    "rule": "semantic-source-rule"
  },
  {
    "category": "configKeys",
    "id": "forgeSynthesisTimeout",
    "source": "packages/core/src/models/types.ts:80",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-synthesis",
    "rule": "semantic-source-rule"
  },
  {
    "category": "configKeys",
    "id": "skillSynthesisThreshold",
    "source": "packages/core/src/models/types.ts:112",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-synthesis",
    "rule": "semantic-source-rule"
  },
  {
    "category": "mcpTools",
    "id": "Synthesis",
    "source": "packages/mcp/src/agon-orchestration.ts:24",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-synthesis",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "AgentInvestigateSynthesisResult",
    "source": "packages/core/src/cesar/agent-synthesis.ts:401",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-synthesis",
    "rule": "semantic-source-rule"
  },
  {
    "category": "resultAndEnvelopeTypes",
    "id": "AgentSynthesisResult",
    "source": "packages/core/src/cesar/agent-synthesis.ts:68",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-synthesis",
    "rule": "semantic-source-rule"
  },
  {
    "category": "tuiSlashCommands",
    "id": "/synthesis",
    "source": "packages/cli/src/signals/intent.ts:56",
    "class": "user-toggleable-mod-package",
    "package": "@kernlang/agon-mod-synthesis",
    "rule": "exact-user-surface"
  }
]);
export const COMPATIBILITY_CONTRIBUTIONS = Object.freeze([
  {
    "id": "cliCommands:0067",
    "publicId": "synthesis",
    "registryKind": "cli-command",
    "category": "cliCommands",
    "source": "packages/cli/src/lazy-commands.ts:314"
  },
  {
    "id": "configKeys:0071",
    "publicId": "forgeEnableSynthesis",
    "registryKind": "config",
    "category": "configKeys",
    "source": "packages/core/src/models/types.ts:70"
  },
  {
    "id": "configKeys:0082",
    "publicId": "forgeSynthesisTimeout",
    "registryKind": "config",
    "category": "configKeys",
    "source": "packages/core/src/models/types.ts:80"
  },
  {
    "id": "configKeys:0113",
    "publicId": "skillSynthesisThreshold",
    "registryKind": "config",
    "category": "configKeys",
    "source": "packages/core/src/models/types.ts:112"
  },
  {
    "id": "mcpTools:0031",
    "publicId": "Synthesis",
    "registryKind": "mcp-tool",
    "category": "mcpTools",
    "source": "packages/mcp/src/agon-orchestration.ts:24"
  },
  {
    "id": "resultAndEnvelopeTypes:0005",
    "publicId": "AgentInvestigateSynthesisResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/cesar/agent-synthesis.ts:401"
  },
  {
    "id": "resultAndEnvelopeTypes:0010",
    "publicId": "AgentSynthesisResult",
    "registryKind": "result-type",
    "category": "resultAndEnvelopeTypes",
    "source": "packages/core/src/cesar/agent-synthesis.ts:68"
  },
  {
    "id": "tuiSlashCommands:0063",
    "publicId": "/synthesis",
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
const resultSchema = Object.freeze({ type: 'object', additionalProperties: true }) as Readonly<Record<string, Json>>;

export function createFirstPartyCompatibilityMod(runtime: FirstPartyCompatibilityRuntime): AgonModV1 {
  return Object.freeze({
    apiVersion: '1' as const,
    async activate(registrar: Registrar): Promise<Dispose> {
      const disposers: Dispose[] = [];
      disposers.push(registrar.command('cli', { id: "cliCommands:0067", description: "synthesis compatibility contribution", inputSchema, run: (input, context) => runtime.command('cli-command', "synthesis", input, context) }));
      disposers.push(registrar.config("configKeys:0071", inputSchema));
      disposers.push(registrar.config("configKeys:0082", inputSchema));
      disposers.push(registrar.config("configKeys:0113", inputSchema));
      disposers.push(registrar.tool('mcp', { id: "mcpTools:0031", description: "Synthesis compatibility contribution", inputSchema, effect: 'process', run: (input, context) => runtime.tool('mcp-tool', "Synthesis", input, context) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0005", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("AgentInvestigateSynthesisResult", payload) }));
      disposers.push(registrar.resultType({ id: "resultAndEnvelopeTypes:0010", schema: resultSchema, readableVersions: '>=0.2.0', render: (payload) => runtime.render("AgentSynthesisResult", payload) }));
      disposers.push(registrar.command('tui', { id: "tuiSlashCommands:0063", description: "/synthesis compatibility contribution", inputSchema, run: (input, context) => runtime.command('tui-action', "/synthesis", input, context) }));
      return async () => { for (const dispose of [...disposers].reverse()) await dispose(); };
    },
  });
}

export const createMod: AgonModFactory = async (services: ModServices): Promise<AgonModV1> => {
  const runtime = (services as FirstPartyServices).firstPartyCompatibility;
  if (!runtime) {
    throw Object.assign(new Error('@kernlang/agon-mod-synthesis requires the S5 legacy compatibility bridge until generated surface cutover'), { code: 'MOD_RESTART_REQUIRED' });
  }
  return createFirstPartyCompatibilityMod(runtime);
};

export default createMod;
