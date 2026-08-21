import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  APPROVAL, CHAT_INPUT, CHAT_OUTPUT, EXTRACT_STRUCTURED, IF_COMPARE, MOVE_FILE,
  NodeRegistry, PORT_VALUE_TYPES, SUBFLOW_NODE_TYPE, V1_NODE_CATALOG, WRITE_FILE,
  createDefaultNodeRegistry,
} from '../../packages/flow-core/src/index.js';

const FLOW_CORE_SRC = join(import.meta.dirname, '..', '..', 'packages', 'flow-core', 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('v1 node catalog', () => {
  it('registers exactly the spec\'s v1 node types', () => {
    expect(V1_NODE_CATALOG.map((descriptor) => descriptor.type).sort()).toEqual([
      'approval', 'chat-input', 'chat-output', 'engine', 'extract-structured',
      'file-picker', 'folder-picker', 'if-compare', 'list-folder',
      'markdown-to-pdf', 'move-file', 'nero-verify', 'read-file', 'template',
      'write-file',
    ]);
    expect(createDefaultNodeRegistry().size).toBe(V1_NODE_CATALOG.length);
  });

  it('never registers `subflow` — its ports are generated per instance', () => {
    expect(createDefaultNodeRegistry().has(SUBFLOW_NODE_TYPE)).toBe(false);
  });

  it('uses only closed port value types (plus the parametric marker)', () => {
    const legal = new Set<string>([...PORT_VALUE_TYPES, 'T']);
    for (const descriptor of V1_NODE_CATALOG) {
      for (const port of [...descriptor.in, ...descriptor.out]) {
        expect(legal.has(port.type), `${descriptor.type}.${port.name}`).toBe(true);
      }
    }
  });

  it('declares parametric passthrough on the control nodes', () => {
    expect(IF_COMPARE.in.map((port) => port.type)).toEqual(['T']);
    expect(IF_COMPARE.out.map((port) => port.type)).toEqual(['T', 'T']);
    expect(APPROVAL.in[0].type).toBe('T');
    expect(APPROVAL.out[0].type).toBe('T');
  });

  it('declares If/Compare\'s two out-ports as ONE exclusive route group', () => {
    const groups = new Set(IF_COMPARE.out.map((port) => port.exclusiveGroup));
    expect(groups).toEqual(new Set(['route']));
    expect(IF_COMPARE.out.map((port) => port.name)).toEqual(['true', 'false']);
    expect(IF_COMPARE.jsonFieldAccess).toEqual({ param: 'field', port: 'in' });
  });

  it('annotates Extract Structured\'s out-port with its schema param', () => {
    expect(EXTRACT_STRUCTURED.out).toEqual([
      { name: 'json', type: 'json', jsonSchemaParam: 'schema' },
    ]);
  });

  it('marks Chat Output\'s in-port coalescing and nothing else', () => {
    expect(CHAT_OUTPUT.in[0].coalescing).toBe(true);
    const coalescing = V1_NODE_CATALOG.filter(
      (descriptor) => descriptor.in.some((port) => port.coalescing),
    );
    expect(coalescing.map((descriptor) => descriptor.type)).toEqual(['chat-output']);
  });

  it('marks exactly the world-touching nodes with effect:true', () => {
    const effects = V1_NODE_CATALOG.filter((descriptor) => descriptor.effect).map((d) => d.type);
    expect(effects.sort()).toEqual(['move-file', 'write-file']);
    expect(WRITE_FILE.effect).toBe(true);
    expect(MOVE_FILE.effect).toBe(true);
  });

  it('gives every input-source node a required paramKey for input promotion', () => {
    const sources = V1_NODE_CATALOG.filter((descriptor) => descriptor.inputSource);
    expect(sources.map((descriptor) => descriptor.type).sort())
      .toEqual(['chat-input', 'file-picker', 'folder-picker']);
    for (const descriptor of sources) {
      expect(descriptor.paramSchema.safeParse({}).success, descriptor.type).toBe(false);
      const port = descriptor.out.find((candidate) => candidate.name === descriptor.inputSource!.port);
      expect(port, `${descriptor.type} names a real out-port`).toBeDefined();
    }
    expect(CHAT_INPUT.paramSchema.safeParse({ paramKey: 'x' }).success).toBe(true);
  });

  it('ships execution stubs only — no descriptor implements execute in slice 1', () => {
    for (const descriptor of V1_NODE_CATALOG) {
      expect(descriptor.execute, `${descriptor.type}.execute`).toBeUndefined();
    }
  });

  it('registry get/has/list round-trip', () => {
    const registry = new NodeRegistry().register(CHAT_INPUT);
    expect(registry.get('chat-input')).toBe(CHAT_INPUT);
    expect(registry.has('nope')).toBe(false);
    expect(registry.list()).toEqual([CHAT_INPUT]);
  });
});

describe('flow-core stays engine-free (zero dispatches by construction)', () => {
  const files = sourceFiles(FLOW_CORE_SRC);

  it('has sources to scan', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('imports no adapter, engine registry or process-spawning module', () => {
    const forbidden = [
      '@kernlang/agon-adapter-cli',
      '@kernlang/agon-core',
      '@kernlang/agon-forge',
      'node:child_process',
      'child_process',
    ];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      for (const specifier of forbidden) {
        expect(source.includes(`'${specifier}'`), `${file} must not import ${specifier}`).toBe(false);
      }
    }
  });

  it('declares no runtime dependency on any agon package', () => {
    const pkg = JSON.parse(readFileSync(join(FLOW_CORE_SRC, '..', 'package.json'), 'utf-8'));
    const buckets = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
    for (const bucket of buckets) {
      const agon = Object.keys(pkg[bucket] ?? {}).filter((dep) => dep.startsWith('@kernlang/agon'));
      expect(agon, `${bucket} must not pull in an agon package`).toEqual([]);
    }
    // zod (the schema binding) is the ONLY runtime dependency it may have.
    expect(Object.keys(pkg.dependencies ?? {})).toEqual(['zod']);
  });

  it('declares every third-party module it imports', () => {
    const pkg = JSON.parse(readFileSync(join(FLOW_CORE_SRC, '..', 'package.json'), 'utf-8'));
    const declared = new Set(Object.keys(pkg.dependencies ?? {}));
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      for (const match of source.matchAll(/ from '([^']+)'/g)) {
        const specifier = match[1];
        if (specifier.startsWith('.') || specifier.startsWith('node:')) continue;
        const name = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0];
        expect(declared.has(name), `${file} imports undeclared "${name}"`).toBe(true);
      }
    }
  });

  it('keeps every source file under the 500-line house limit', () => {
    for (const file of files) {
      const lines = readFileSync(file, 'utf-8').split('\n').length;
      expect(lines, `${file} is ${lines} lines`).toBeLessThan(500);
    }
  });
});
