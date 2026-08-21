import { describe, expect, it } from 'vitest';
import { join } from 'node:path';

import {
  createMemoryFlowLoader, elaborateDocument, elaborateFlowFile, serializeFlow,
  type ElaborationResult, type FlowDocument, type FlowErrorCode,
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
    const id = ulid('APRV');
    const result = elaborate(doc({ nodes: [node(id, 'approval', {})] }));
    expect(codes(result)).toContain('PARAMETRIC_UNRESOLVED');
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
