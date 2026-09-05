import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

/** Exercise installed bytes, not source imports. Caller owns the scratch tree. */
export async function verifyPackedMcp(prefix, scratch, env) {
  const child = spawn(process.execPath, ['--import', join(import.meta.dirname, 'fixtures/block-mcp-provider-effects.mjs'),
    join(prefix, 'node_modules/@kernlang/agon/dist/mcp/index.js')], {
    cwd: scratch, env: { ...env, AGON_HOME: join(scratch, 'mcp-home'),
      AGON_MODULAR_HOST_ROOT: join(scratch, 'mcp-home/modular-host') }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const pending = new Map();
  let nextId = 0;
  let stderr = '';
  const closed = once(child, 'close');
  const failPending = (error) => { for (const request of pending.values()) request.reject(error); pending.clear(); };
  child.on('error', failPending);
  child.on('close', () => failPending(new Error('packed MCP closed before responding')));
  child.stderr.on('data', bytes => { stderr = (stderr + bytes.toString()).slice(-8192); });
  const lines = createInterface({ input: child.stdout });
  lines.on('line', line => {
    try {
      const response = JSON.parse(line);
      const request = pending.get(response.id);
      if (!request) return;
      pending.delete(response.id);
      request.resolve(response);
    } catch { failPending(new Error('packed MCP emitted non-JSON stdout')); }
  });
  const request = async (method, params) => {
    const id = ++nextId;
    let timer;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(() => { pending.delete(id); reject(new Error(`packed MCP timed out: ${method}`)); }, 20_000);
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
      });
    } finally { clearTimeout(timer); }
  };
  const call = (name, args) => request('tools/call', { name, arguments: args });
  try {
    assert.equal((await request('initialize', {})).result.serverInfo.name, 'agon-orchestration');
    const tools = (await request('tools/list', {})).result.tools;
    assert.ok(tools.some(tool => tool.name === 'Brainstorm'));
    const empty = await call('RoomList', {});
    assert.equal(empty.error, undefined);
    assert.equal(empty.result.isError, undefined);
    assert.deepEqual(JSON.parse(empty.result.content[0].text), []);
    const failed = await call('Brainstorm', { question: 'Fixture only', engines: 'codex' });
    assert.equal(failed.error, undefined);
    assert.equal(failed.result.isError, true);
    assert.match(failed.result.content[0].text, /no usable responses/);
    assert.match(stderr, /PACKED_MCP_EFFECT_BLOCKED/);
    const missing = await call('JobStatus', { jobId: 'absent-fixture' });
    assert.equal(missing.result.isError, true);
    assert.match(missing.result.content[0].text, /Job not found/);
    const cyclic = await call('ProposePlan', { intent: 'fixture', steps: [
      { id: 'a', type: 'think', description: 'fixture', dependsOn: ['a'] },
    ] });
    assert.equal(cyclic.error, undefined, JSON.stringify(cyclic));
    assert.equal(cyclic.result.isError, true);
    assert.match(cyclic.result.content[0].text, /circular dependency/);
    const unknown = await call('NoSuchFixtureTool', {});
    assert.equal(unknown.error.code, -32602);
    return { id: 'packed-mcp-failure-contract', passed: true,
      detail: 'installed server: success, blocked-provider failure, missing job, cyclic plan, unknown tool' };
  } finally {
    child.stdin.end();
    const kill = setTimeout(() => child.kill('SIGKILL'), 3000);
    try { await closed; } finally { clearTimeout(kill); lines.close(); }
  }
}
