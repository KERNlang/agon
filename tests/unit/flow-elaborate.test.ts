import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import {
  createMemoryFlowLoader, elaborateDocument, elaborateFlowFile, serializeFlow,
  type ElaboratedFlow, type ElaborationResult, type FlowDocument, type FlowErrorCode,
} from '../../packages/flow-core/src/index.js';
import { doc, edge, node, ulid } from '../helpers/flow-doc.js';

const FIXTURES = join(import.meta.dirname, '..', 'fixtures', 'flow');
const MAIN = '/flows/main.agon-flow.json';

function elaborate(document: FlowDocument, files: Record<string, string> = {}): ElaborationResult {
  return elaborateDocument(document, {
    loader: createMemoryFlowLoader({ [MAIN]: serializeFlow(document), ...files }),
    file: MAIN,
  });
}

function codes(result: ElaborationResult): FlowErrorCode[] {
  return result.ok ? [] : result.errors.map((error) => error.code);
}

/**
 * Structural invariant every `ok:true` elaboration must satisfy: no step input
 * and no declared output may point at a step id that is not in the DAG.
 */
function expectNoDanglingRefs(flow: ElaboratedFlow): void {
  const ids = flow.steps.map((step) => step.id);
  for (const step of flow.steps) {
    for (const input of step.inputs) expect(ids).toContain(input.fromStep);
    for (const upstream of step.requiredUpstream) expect(ids).toContain(upstream);
  }
  for (const output of flow.outputs) expect(ids).toContain(output.stepId);
  for (const param of flow.params) {
    if (param.stepId !== undefined) expect(ids).toContain(param.stepId);
  }
}

function errorOf(result: ElaborationResult, code: FlowErrorCode) {
  if (result.ok) throw new Error(`expected ${code}, but elaboration succeeded`);
  const found = result.errors.find((error) => error.code === code);
  if (!found) throw new Error(`expected ${code}, got: ${JSON.stringify(result.errors, null, 2)}`);
  return found;
}

// ── Golden files ──────────────────────────────────────────────────────────

describe('elaborate — golden flows', () => {
  it('elaborates the build-CV proof flow into a flat typed step-DAG', () => {
    const result = elaborateFlowFile(join(FIXTURES, 'build-cv.agon-flow.json'));
    expect(codes(result)).toEqual([]);
    if (!result.ok) return;

    expect(result.flow.name).toBe('build-CV');
    expect(result.flow.steps.map((step) => step.type)).toEqual(expect.arrayContaining([
      'chat-input', 'engine', 'nero-verify', 'approval', 'markdown-to-pdf', 'write-file',
    ]));
    // Topologically ordered: every input is produced before it is consumed.
    const seen = new Set<string>();
    for (const step of result.flow.steps) {
      for (const input of step.inputs) expect(seen.has(input.fromStep)).toBe(true);
      seen.add(step.id);
    }
    // Write File is the only world-touching step.
    expect(result.flow.effects).toHaveLength(1);
    const writeStep = result.flow.steps.find((step) => step.type === 'write-file');
    expect(writeStep?.effect).toBe(true);
    expect(result.flow.effects).toEqual([writeStep?.id]);
    // Declared outputs carry their resolved nominal types.
    expect(result.flow.outputs).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'cv', type: 'file' }),
      expect.objectContaining({ name: 'verification', type: 'json' }),
    ]));
  });

  it('resolves parametric T and the json schema it carries through sort-folder', () => {
    const result = elaborateFlowFile(join(FIXTURES, 'sort-folder.agon-flow.json'));
    expect(codes(result)).toEqual([]);
    if (!result.ok) return;

    // Approval passes a fileset through unchanged (T := fileset).
    const approval = result.flow.steps.find((step) => step.type === 'approval');
    expect(approval?.outputs).toEqual([expect.objectContaining({ name: 'out', type: 'fileset' })]);

    // If/Compare passes json through, and both branches carry the declared
    // Extract Structured schema so a downstream field access stays checkable.
    const branch = result.flow.steps.find((step) => step.type === 'if-compare');
    expect(branch?.outputs.map((port) => [port.name, port.type, port.exclusiveGroup])).toEqual([
      ['true', 'json', 'route'],
      ['false', 'json', 'route'],
    ]);
    expect(branch?.outputs[0].jsonSchema?.properties).toHaveProperty('confidence');
  });

  it('records exclusive-route metadata and a legal coalesce on Chat Output', () => {
    const result = elaborateFlowFile(join(FIXTURES, 'sort-folder.agon-flow.json'));
    if (!result.ok) throw new Error('sort-folder must elaborate');

    const branchId = result.flow.steps.find((step) => step.type === 'if-compare')!.id;
    const output = result.flow.steps.find((step) => step.type === 'chat-output')!;

    expect(output.coalescingPorts).toEqual(['in']);
    expect(output.inputs.map((input) => input.routeSet)).toEqual([
      [{ stepId: branchId, group: 'route', branch: 'true' }],
      [{ stepId: branchId, group: 'route', branch: 'false' }],
    ]);
    // The coalesce itself is unconditional — it runs whichever branch fired.
    expect(output.routeSet).toEqual([]);
    // …and a coalescing port never propagates SKIP.
    expect(output.requiredUpstream).toEqual([]);
  });

  it('marks steps downstream of one branch with that branch\'s route condition', () => {
    const chat = ulid('CHAT');
    const branch = ulid('CMPARE');
    const approve = ulid('APRV');
    const result = elaborate(doc({
      nodes: [
        node(chat, 'chat-input', { paramKey: 'x' }),
        node(branch, 'if-compare', { operator: 'contains', threshold: 'a' }),
        node(approve, 'approval', {}),
      ],
      edges: [edge(`${chat}.text`, `${branch}.in`), edge(`${branch}.true`, `${approve}.in`)],
    }));
    expect(codes(result)).toEqual([]);
    if (!result.ok) return;
    const step = result.flow.steps.find((candidate) => candidate.id === approve);
    expect(step?.routeSet).toEqual([{ stepId: branch, group: 'route', branch: 'true' }]);
    expect(step?.requiredUpstream).toEqual([branch]);
  });
});

// ── Subflows ──────────────────────────────────────────────────────────────

describe('elaborate — subflow resolution', () => {
  const parentPath = join(FIXTURES, 'cv-with-subflow.agon-flow.json');

  it('inlines a subflow, binds an edge-fed param and namespaces the rest', () => {
    const result = elaborateFlowFile(parentPath);
    expect(codes(result)).toEqual([]);
    if (!result.ok) return;

    const subflowNodeId = ulid('PSSBF');
    // The inner nodes joined the parent graph under a path-qualified id…
    const inlined = result.flow.steps.filter((step) => step.id.startsWith(`${subflowNodeId}/`));
    expect(inlined.length).toBeGreaterThan(0);
    expect(inlined.every((step) => step.path).valueOf()).toBe(true);
    // …and the edge-bound `signature` input node was dropped, its consumer
    // rewired straight to the parent's Engine step.
    const template = inlined.find((step) => step.type === 'template')!;
    expect(template.inputs.some((input) => input.fromStep === ulid('PSDRAFT'))).toBe(true);
    expect(result.flow.params.map((param) => param.key)).not.toContain('signature');
  });

  it('promotes input params: paramKey → effective params, namespaced per subflow instance', () => {
    const result = elaborateFlowFile(parentPath);
    if (!result.ok) throw new Error('fixture must elaborate');
    const subflowNodeId = ulid('PSSBF');

    const keys = result.flow.params.map((param) => param.key);
    expect(keys).toContain('experience');                       // top-level promotion
    expect(keys).toContain(`${subflowNodeId}.footer`);          // namespaced promotion
    expect(keys).toContain('locale');                           // aliased promotion

    const footer = result.flow.params.find((param) => param.key === `${subflowNodeId}.footer`)!;
    expect(footer.source).toBe('promoted');
    expect(footer.paramKey).toBe('footer');
    expect(footer.required).toBe(true);

    const locale = result.flow.params.find((param) => param.key === 'locale')!;
    expect(locale.aliasOf).toBe(`${subflowNodeId}.locale`);
    expect(locale.required).toBe(false);   // it has a default
    expect(locale.default).toBe('de-CH');

    // Each promoted param is stamped back onto the step that consumes it.
    for (const param of result.flow.params) {
      const step = result.flow.steps.find((candidate) => candidate.id === param.stepId);
      expect(step?.paramKey).toBe(param.key);
    }
  });

  it('promotes a top-level input node with its own paramKey', () => {
    const chat = ulid('CHAT');
    const result = elaborate(doc({
      nodes: [node(chat, 'chat-input', { paramKey: 'experience', label: 'Your experience' })],
    }));
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.flow.params).toEqual([
      expect.objectContaining({
        key: 'experience', type: 'text', source: 'promoted', required: true, stepId: chat,
      }),
    ]);
  });
});

// ── One failing fixture per elaboration error class ───────────────────────

describe('elaborate — port type mismatch', () => {
  it('rejects text → folder with no implicit coercion', () => {
    const chat = ulid('CHAT');
    const list = ulid('SCAN');
    const result = elaborate(doc({
      nodes: [node(chat, 'chat-input', { paramKey: 'x' }), node(list, 'list-folder', {})],
      edges: [edge(`${chat}.text`, `${list}.folder`)],
    }));
    const error = errorOf(result, 'PORT_TYPE_MISMATCH');
    expect(error.nodeId).toBe(list);
    expect(error.message).toContain('expects folder');
    expect(error.message).toContain('produces text');
  });
});

describe('elaborate — unresolved subflow', () => {
  it('reports the subflow node when the referenced file is missing', () => {
    const sub = ulid('SBF');
    const result = elaborate(doc({
      nodes: [node(sub, 'subflow', {}, { flow: './missing.agon-flow.json' })],
    }));
    const error = errorOf(result, 'SUBFLOW_UNRESOLVED');
    expect(error.nodeId).toBe(sub);
    expect(error.message).toContain('missing.agon-flow.json');
  });

  it('reports a subflow node with no `flow` reference at all', () => {
    const sub = ulid('SBF');
    const result = elaborate(doc({ nodes: [node(sub, 'subflow', {})] }));
    expect(errorOf(result, 'SUBFLOW_UNRESOLVED').nodeId).toBe(sub);
  });
});

describe('elaborate — recursive subflow', () => {
  it('rejects a flow that references itself', () => {
    const sub = ulid('SBF');
    const document = doc({ nodes: [node(sub, 'subflow', {}, { flow: './main.agon-flow.json' })] });
    const result = elaborate(document);
    const error = errorOf(result, 'SUBFLOW_RECURSION');
    expect(error.nodeId).toBe(sub);
  });

  it('rejects mutual recursion A → B → A', () => {
    const outer = ulid('SBFA');
    const inner = ulid('SBFB');
    const other = doc({
      id: ulid('BBB'),
      name: 'other',
      nodes: [node(inner, 'subflow', {}, { flow: './main.agon-flow.json' })],
    });
    const main = doc({ nodes: [node(outer, 'subflow', {}, { flow: './other.agon-flow.json' })] });
    const result = elaborateDocument(main, {
      loader: createMemoryFlowLoader({
        [MAIN]: serializeFlow(main),
        '/flows/other.agon-flow.json': serializeFlow(other),
      }),
      file: MAIN,
    });
    const error = errorOf(result, 'SUBFLOW_RECURSION');
    expect(error.nodeId).toBe(`${outer}/${inner}`);
  });
});

describe('elaborate — subflow version mismatch', () => {
  const child = doc({ id: ulid('CHDD'), name: 'child', version: '1.2.0', nodes: [] });

  function parentWith(range: string) {
    const sub = ulid('SBF');
    const main = doc({ nodes: [node(sub, 'subflow', {}, { flow: './child.agon-flow.json', version: range })] });
    return {
      sub,
      result: elaborateDocument(main, {
        loader: createMemoryFlowLoader({
          [MAIN]: serializeFlow(main),
          '/flows/child.agon-flow.json': serializeFlow(child),
        }),
        file: MAIN,
      }),
    };
  }

  it('accepts a version inside the declared range', () => {
    expect(codes(parentWith('^1.2').result)).toEqual([]);
  });

  it('rejects a version outside the declared range', () => {
    const { sub, result } = parentWith('^2.0');
    const error = errorOf(result, 'SUBFLOW_VERSION_MISMATCH');
    expect(error.nodeId).toBe(sub);
    expect(error.message).toContain('1.2.0');
    expect(error.message).toContain('^2.0');
  });

  it('rejects a malformed range rather than matching anything', () => {
    expect(codes(parentWith('~~nope').result)).toContain('SUBFLOW_VERSION_MISMATCH');
  });
});

describe('elaborate — cycles', () => {
  it('rejects a two-engine feedback loop, addressed at a node on the cycle', () => {
    const a = ulid('ENGA');
    const b = ulid('ENGB');
    const result = elaborate(doc({
      nodes: [node(a, 'engine', { engineId: 'claude' }), node(b, 'engine', { engineId: 'codex' })],
      edges: [edge(`${a}.text`, `${b}.prompt`), edge(`${b}.text`, `${a}.prompt`)],
    }));
    const error = errorOf(result, 'CYCLE');
    expect([a, b]).toContain(error.nodeId);
    expect(error.message).toContain('→');
  });
});

describe('elaborate — json field access', () => {
  function withField(field: string, schemaProperties: Record<string, unknown>) {
    const chat = ulid('CHAT');
    const extract = ulid('EXTRCT');
    const branch = ulid('CMPARE');
    return {
      branch,
      result: elaborate(doc({
        nodes: [
          node(chat, 'chat-input', { paramKey: 'x' }),
          node(extract, 'extract-structured', {
            schema: { type: 'object', properties: schemaProperties },
          }),
          node(branch, 'if-compare', { field, operator: '>', threshold: 0.8 }),
        ],
        edges: [edge(`${chat}.text`, `${extract}.text`), edge(`${extract}.json`, `${branch}.in`)],
      })),
    };
  }

  it('accepts a field present in the upstream declared schema', () => {
    expect(codes(withField('confidence', { confidence: { type: 'number' } }).result)).toEqual([]);
  });

  it('rejects a field the upstream schema does not declare', () => {
    const { branch, result } = withField('confidance', { confidence: { type: 'number' } });
    const error = errorOf(result, 'JSON_FIELD_MISS');
    expect(error.nodeId).toBe(branch);
    expect(error.message).toContain('confidance');
    expect(error.message).toContain('confidence');
  });

  it('rejects a nested field the schema does not declare', () => {
    const { result } = withField('meta.score', {
      meta: { type: 'object', properties: { label: { type: 'string' } } },
    });
    expect(errorOf(result, 'JSON_FIELD_MISS').message).toContain('score');
  });

  it('rejects a json field access on a non-json passthrough', () => {
    const chat = ulid('CHAT');
    const branch = ulid('CMPARE');
    const result = elaborate(doc({
      nodes: [
        node(chat, 'chat-input', { paramKey: 'x' }),
        node(branch, 'if-compare', { field: 'confidence', operator: '>', threshold: 1 }),
      ],
      edges: [edge(`${chat}.text`, `${branch}.in`)],
    }));
    expect(errorOf(result, 'PARAM_INVALID').message).toContain('in-port "in" carries text');
  });
});

describe('elaborate — exclusive routes', () => {
  it('rejects a step whose required inputs come from two exclusive routes', () => {
    const picker = ulid('FDR');
    const branch = ulid('CMPARE');
    const scan = ulid('SCAN');
    const move = ulid('MVE');
    const result = elaborate(doc({
      nodes: [
        node(picker, 'folder-picker', { paramKey: 'folder' }),
        node(branch, 'if-compare', { operator: 'contains', threshold: 'x' }),
        node(scan, 'list-folder', {}),
        node(move, 'move-file', {}),
      ],
      edges: [
        edge(`${picker}.folder`, `${branch}.in`),
        edge(`${branch}.true`, `${move}.folder`),
        edge(`${branch}.false`, `${scan}.folder`),
        edge(`${scan}.fileset`, `${move}.files`),
      ],
    }));
    const error = errorOf(result, 'MIXED_EXCLUSIVE_ROUTES');
    expect(error.nodeId).toBe(move);
    expect(error.message).toContain('could never run');
  });

  it('rejects a coalesce onto a port the node type does not declare coalescing', () => {
    const chat = ulid('CHAT');
    const branch = ulid('CMPARE');
    const approve = ulid('APRV');
    const result = elaborate(doc({
      nodes: [
        node(chat, 'chat-input', { paramKey: 'x' }),
        node(branch, 'if-compare', { operator: 'contains', threshold: 'a' }),
        node(approve, 'approval', {}),
      ],
      edges: [
        edge(`${chat}.text`, `${branch}.in`),
        edge(`${branch}.true`, `${approve}.in`),
        edge(`${branch}.false`, `${approve}.in`),
      ],
    }));
    const error = errorOf(result, 'COALESCE_ILLEGAL');
    expect(error.nodeId).toBe(approve);
    expect(error.message).toContain('does not declare it coalescing');
  });

  it('rejects a port fed by two concurrently live edges', () => {
    const a = ulid('CHATA');
    const b = ulid('CHATB');
    const output = ulid('RPRT');
    const result = elaborate(doc({
      nodes: [
        node(a, 'chat-input', { paramKey: 'a' }),
        node(b, 'chat-input', { paramKey: 'b' }),
        node(output, 'chat-output', {}),
      ],
      edges: [edge(`${a}.text`, `${output}.in`), edge(`${b}.text`, `${output}.in`)],
    }));
    expect(errorOf(result, 'COALESCE_ILLEGAL').message).toContain('concurrently live');
  });
});

describe('elaborate — routes through optional-only steps', () => {
  // Chat Input → If → Template per branch → Chat Output. Both Templates hang
  // off the branch by their OPTIONAL `text` port, so their route condition can
  // only come from an optional in-port.
  function branchedTemplates(): ElaborationResult {
    const chat = ulid('CHAT');
    const branch = ulid('CMPARE');
    const yes = ulid('TMPA');
    const no = ulid('TMPB');
    const render = ulid('RENDER');
    return elaborate(doc({
      nodes: [
        node(chat, 'chat-input', { paramKey: 'x' }),
        node(branch, 'if-compare', { operator: 'contains', threshold: 'a' }),
        node(yes, 'template', { template: 'yes: {{text}}' }),
        node(no, 'template', { template: 'no: {{text}}' }),
        node(render, 'chat-output', {}),
      ],
      edges: [
        edge(`${chat}.text`, `${branch}.in`),
        edge(`${branch}.true`, `${yes}.text`),
        edge(`${branch}.false`, `${no}.text`),
        edge(`${yes}.text`, `${render}.in`),
        edge(`${no}.text`, `${render}.in`),
      ],
    }));
  }

  it('accepts a coalesce of two branches that each transit an optional-input step', () => {
    const result = branchedTemplates();
    expect(codes(result)).toEqual([]);
    if (!result.ok) return;

    const branch = ulid('CMPARE');
    const yes = result.flow.steps.find((step) => step.id === ulid('TMPA'))!;
    const no = result.flow.steps.find((step) => step.id === ulid('TMPB'))!;
    // Each Template inherits the branch it hangs off — it is NOT unconditional.
    expect(yes.routeSet).toEqual([{ stepId: branch, group: 'route', branch: 'true' }]);
    expect(no.routeSet).toEqual([{ stepId: branch, group: 'route', branch: 'false' }]);
    // …which is exactly what makes the Chat Output coalesce legal.
    const render = result.flow.steps.find((step) => step.id === ulid('RENDER'))!;
    expect(render.coalescingPorts).toEqual(['in']);
    expect(render.routeSet).toEqual([]);
  });

  it('still rejects ONE variadic port collecting both branches', () => {
    const chat = ulid('CHAT');
    const branch = ulid('CMPARE');
    const merge = ulid('TMPA');
    const result = elaborate(doc({
      nodes: [
        node(chat, 'chat-input', { paramKey: 'x' }),
        node(branch, 'if-compare', { operator: 'contains', threshold: 'a' }),
        node(merge, 'template', { template: '{{text}}' }),
      ],
      edges: [
        edge(`${chat}.text`, `${branch}.in`),
        edge(`${branch}.true`, `${merge}.text`),
        edge(`${branch}.false`, `${merge}.text`),
      ],
    }));
    // A collector cannot join routes that are never live together.
    expect(errorOf(result, 'COALESCE_ILLEGAL').message).toContain('collects several values');
  });

  it('leaves a step unconditional when its optional ports ride different decisions', () => {
    const chat = ulid('CHAT');
    const textBranch = ulid('CMPARE');
    const extract = ulid('EXTRCT');
    const jsonBranch = ulid('CMPARB');
    const merge = ulid('TMPA');
    const result = elaborate(doc({
      nodes: [
        node(chat, 'chat-input', { paramKey: 'x' }),
        node(textBranch, 'if-compare', { operator: 'contains', threshold: 'a' }),
        node(extract, 'extract-structured', { schema: { type: 'object' } }),
        node(jsonBranch, 'if-compare', { operator: 'contains', threshold: 'b' }),
        node(merge, 'template', { template: '{{text}} {{json}}' }),
      ],
      edges: [
        edge(`${chat}.text`, `${textBranch}.in`),
        edge(`${chat}.text`, `${extract}.text`),
        edge(`${extract}.json`, `${jsonBranch}.in`),
        edge(`${textBranch}.true`, `${merge}.text`),
        edge(`${jsonBranch}.false`, `${merge}.json`),
      ],
    }));
    expect(codes(result)).toEqual([]);
    if (!result.ok) return;
    // Either optional input can carry it, so no single decision gates the step.
    expect(result.flow.steps.find((step) => step.id === merge)!.routeSet).toEqual([]);
  });

  it('still ignores an optional input when a REQUIRED port already pins the route', () => {
    const chat = ulid('CHAT');
    const branch = ulid('CMPARE');
    const engine = ulid('ENG');
    const result = elaborate(doc({
      nodes: [
        node(chat, 'chat-input', { paramKey: 'x' }),
        node(branch, 'if-compare', { operator: 'contains', threshold: 'a' }),
        node(engine, 'engine', { engineId: 'claude' }),
      ],
      edges: [
        edge(`${chat}.text`, `${branch}.in`),
        edge(`${branch}.true`, `${engine}.prompt`),
      ],
    }));
    expect(codes(result)).toEqual([]);
    if (!result.ok) return;
    expect(result.flow.steps.find((step) => step.id === engine)!.routeSet)
      .toEqual([{ stepId: branch, group: 'route', branch: 'true' }]);
  });
});

describe('elaborate — paramKey collisions', () => {
  it('rejects two input nodes claiming the same paramKey', () => {
    const a = ulid('CHATA');
    const b = ulid('CHATB');
    const result = elaborate(doc({
      nodes: [
        node(a, 'chat-input', { paramKey: 'experience' }),
        node(b, 'chat-input', { paramKey: 'experience' }),
      ],
    }));
    const error = errorOf(result, 'PARAM_KEY_COLLISION');
    expect(error.message).toContain('experience');
  });

  it('rejects two subflow aliases collapsing onto the same effective key', () => {
    const sub = ulid('SBF');
    const inner = doc({
      id: ulid('CHDD'),
      name: 'child',
      nodes: [
        node(ulid('CHATA'), 'chat-input', { paramKey: 'a' }),
        node(ulid('CHATB'), 'chat-input', { paramKey: 'b' }),
      ],
    });
    const main = doc({
      nodes: [node(sub, 'subflow', {}, {
        flow: './child.agon-flow.json',
        aliases: { [`${sub}.a`]: 'shared', [`${sub}.b`]: 'shared' },
      })],
    });
    const result = elaborateDocument(main, {
      loader: createMemoryFlowLoader({
        [MAIN]: serializeFlow(main),
        '/flows/child.agon-flow.json': serializeFlow(inner),
      }),
      file: MAIN,
    });
    expect(errorOf(result, 'PARAM_KEY_COLLISION').message).toContain('shared');
  });
});

describe('elaborate — structural errors', () => {
  it('rejects an unknown node type', () => {
    const id = ulid('NPE');
    const result = elaborate(doc({ nodes: [node(id, 'quantum-oracle', {})] }));
    expect(errorOf(result, 'UNKNOWN_NODE_TYPE').nodeId).toBe(id);
  });

  it('rejects node params that fail the descriptor schema', () => {
    const id = ulid('ENG');
    const result = elaborate(doc({ nodes: [node(id, 'engine', { engineId: '', maxRetries: 99 })] }));
    const error = errorOf(result, 'PARAM_INVALID');
    expect(error.nodeId).toBe(id);
  });

  it('rejects an edge naming a port the node type does not have', () => {
    const chat = ulid('CHAT');
    const engine = ulid('ENG');
    const result = elaborate(doc({
      nodes: [node(chat, 'chat-input', { paramKey: 'x' }), node(engine, 'engine', { engineId: 'claude' })],
      edges: [edge(`${chat}.text`, `${engine}.nonsense`)],
    }));
    expect(errorOf(result, 'PORT_UNRESOLVED').message).toContain('nonsense');
  });

  it('rejects an unconnected required in-port', () => {
    const id = ulid('ENG');
    const result = elaborate(doc({ nodes: [node(id, 'engine', { engineId: 'claude' })] }));
    expect(errorOf(result, 'PORT_UNRESOLVED').message).toContain('required in-port "prompt"');
  });

  it('rejects a write-file with neither content nor source connected', () => {
    const id = ulid('WRTE');
    const result = elaborate(doc({ nodes: [node(id, 'write-file', {})] }));
    expect(errorOf(result, 'PORT_UNRESOLVED').message).toContain('at least one');
  });

  it('rejects an unresolvable parametric passthrough', () => {
    // `first` never resolves T, so `second` is wired to a port with no type.
    const first = ulid('APRV');
    const second = ulid('APRVB');
    const result = elaborate(doc({
      nodes: [node(first, 'approval', {}), node(second, 'approval', {})],
      edges: [edge(`${first}.out`, `${second}.in`)],
    }));
    const error = errorOf(result, 'PARAMETRIC_UNRESOLVED');
    expect(error.nodeId).toBe(second);
    expect(error.message).toContain(`${first}.out`);
  });

  it('reports an unconnected required passthrough port exactly once', () => {
    const id = ulid('APRV');
    const result = elaborate(doc({ nodes: [node(id, 'approval', {})] }));
    // One root cause, one diagnostic: the missing connection — not that plus a
    // PARAMETRIC_UNRESOLVED restating it.
    expect(codes(result)).toEqual(['PORT_UNRESOLVED']);
    expect(errorOf(result, 'PORT_UNRESOLVED').message).toContain('required in-port "in"');
  });

  it('rejects `flow`/`version` on a node that is not a subflow', () => {
    const id = ulid('CHAT');
    const result = elaborate(doc({
      nodes: [node(id, 'chat-input', { paramKey: 'x' }, { flow: './other.agon-flow.json' })],
    }));
    expect(errorOf(result, 'PARAM_INVALID').message).toContain('only valid on a subflow node');
  });

  it('reports a missing entry file instead of throwing', () => {
    const result = elaborateFlowFile(join(FIXTURES, 'does-not-exist.agon-flow.json'));
    expect(codes(result)).toEqual(['FLOW_FILE_UNRESOLVED']);
  });
});

describe('elaborate — duplicate flow outputs', () => {
  it('rejects two outputs claiming the same name instead of overwriting', () => {
    const chat = ulid('CHAT');
    const engine = ulid('ENG');
    const result = elaborate(doc({
      nodes: [
        node(chat, 'chat-input', { paramKey: 'x' }),
        node(engine, 'engine', { engineId: 'claude' }),
      ],
      edges: [edge(`${chat}.text`, `${engine}.prompt`)],
      outputs: [
        { name: 'answer', from: `${engine}.text` },
        { name: 'answer', from: `${chat}.text` },
      ],
    }));
    const error = errorOf(result, 'OUTPUT_NAME_COLLISION');
    expect(error.message).toContain('"answer"');
    expect(error.message).toContain('more than once');
  });

  it('rejects a duplicate output name inside a SUBFLOW too', () => {
    const sub = ulid('SBF');
    const inner = ulid('NNER');
    const child = doc({
      id: ulid('CHDD'),
      name: 'child',
      nodes: [node(inner, 'chat-input', { paramKey: 'msg' })],
      outputs: [
        { name: 'echo', from: `${inner}.text` },
        { name: 'echo', from: `${inner}.text` },
      ],
    });
    const main = doc({
      nodes: [node(sub, 'subflow', {}, { flow: './child.agon-flow.json' })],
    });
    const result = elaborateDocument(main, {
      loader: createMemoryFlowLoader({
        [MAIN]: serializeFlow(main),
        '/flows/child.agon-flow.json': serializeFlow(child),
      }),
      file: MAIN,
    });
    expect(codes(result)).toContain('OUTPUT_NAME_COLLISION');
  });
});

// ── Graph invariants ──────────────────────────────────────────────────────

describe('elaborate — graph invariants', () => {
  function withChild(main: FlowDocument, child: FlowDocument): ElaborationResult {
    return elaborateDocument(main, {
      loader: createMemoryFlowLoader({
        [MAIN]: serializeFlow(main),
        '/flows/child.agon-flow.json': serializeFlow(child),
      }),
      file: MAIN,
    });
  }

  it('rewires a parent edge that reads a subflow output transiting a bound input', () => {
    const chat = ulid('CHAT');
    const sub = ulid('SBF');
    const show = ulid('RENDER');
    const inner = ulid('NNER');
    const child = doc({
      id: ulid('CHDD'),
      name: 'child',
      nodes: [node(inner, 'chat-input', { paramKey: 'msg' })],
      outputs: [{ name: 'echo', from: `${inner}.text` }],
    });
    const main = doc({
      nodes: [
        node(chat, 'chat-input', { paramKey: 'x' }),
        node(sub, 'subflow', {}, { flow: './child.agon-flow.json' }),
        node(show, 'chat-output', {}),
      ],
      edges: [edge(`${chat}.text`, `${sub}.msg`), edge(`${sub}.echo`, `${show}.in`)],
    });

    const result = withChild(main, child);
    expect(codes(result)).toEqual([]);
    if (!result.ok) return;
    expectNoDanglingRefs(result.flow);

    // The promoted input node is gone and the parent edge reads the parent's
    // own Chat Input — with its real type, not a silent `json` default.
    expect(result.flow.steps.map((step) => step.id)).not.toContain(`${sub}/${inner}`);
    const output = result.flow.steps.find((step) => step.id === show)!;
    expect(output.inputs).toEqual([expect.objectContaining({ fromStep: chat, fromPort: 'text', type: 'text' })]);
    expect(result.flow.params.map((param) => param.key)).toEqual(['x']);
  });

  it('rewires a declared flow output that reads a subflow output transiting a bound input', () => {
    const chat = ulid('CHAT');
    const sub = ulid('SBF');
    const inner = ulid('NNER');
    const child = doc({
      id: ulid('CHDD'),
      name: 'child',
      nodes: [node(inner, 'chat-input', { paramKey: 'msg' })],
      outputs: [{ name: 'echo', from: `${inner}.text` }],
    });
    const main = doc({
      nodes: [
        node(chat, 'chat-input', { paramKey: 'x' }),
        node(sub, 'subflow', {}, { flow: './child.agon-flow.json' }),
      ],
      edges: [edge(`${chat}.text`, `${sub}.msg`)],
      outputs: [{ name: 'result', from: `${sub}.echo` }],
    });

    const result = withChild(main, child);
    expect(codes(result)).toEqual([]);
    if (!result.ok) return;
    expectNoDanglingRefs(result.flow);
    expect(result.flow.outputs).toEqual([
      expect.objectContaining({ name: 'result', stepId: chat, port: 'text', type: 'text' }),
    ]);
  });

  it('keeps the golden proof flows free of dangling refs', () => {
    for (const name of ['build-cv', 'sort-folder', 'cv-with-subflow']) {
      const result = elaborateFlowFile(join(FIXTURES, `${name}.agon-flow.json`));
      if (!result.ok) throw new Error(`${name}: ${JSON.stringify(result.errors, null, 2)}`);
      expectNoDanglingRefs(result.flow);
    }
  });
});
