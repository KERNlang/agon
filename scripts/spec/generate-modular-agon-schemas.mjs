import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { schemas } from '../../docs/specs/fixtures/modular-agon-contracts/contracts.mjs';

const root = resolve(import.meta.dirname, '../..');
const out = join(root, 'docs/specs/schemas');
mkdirSync(out, { recursive: true });
for (const [name, schema] of Object.entries(schemas)) {
  const json = z.toJSONSchema(schema, { target: 'draft-2020-12' });
  json.$id = `https://kernlang.dev/schemas/agon/modular/v1/${name}.schema.json`;
  json.title = `Modular Agon v1 ${name}`;
  writeFileSync(join(out, `modular-agon-${name}.schema.json`), `${JSON.stringify(json, null, 2)}\n`);
}
console.log(`generated ${Object.keys(schemas).length} schemas`);
