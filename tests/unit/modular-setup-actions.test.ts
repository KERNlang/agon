import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSetupActionPlan, executeSetupAction, type SetupActionDefinition } from '../../packages/mod-kernel/src/setup-actions.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'agon-setup-action-'));
  const executable = join(root, 'bin', 'setup.js');
  await mkdir(join(root, 'bin'));
  const bytes = '#!/usr/bin/env node\n';
  await writeFile(executable, bytes);
  const definition: SetupActionDefinition = {
    id: 'prepare-python',
    packageId: '@test/python',
    kind: 'python-environment',
    executable: 'bin/setup.js',
    executableHash: `sha256:${createHash('sha256').update(bytes).digest('hex')}`,
    args: ['--isolated'],
    declaredOutputs: ['state/python'],
    requiresNetwork: false,
    timeoutMs: 2_000,
    maxOutputBytes: 1_024,
  };
  return { root, executable, definition };
}

describe('typed setup actions', () => {
  it('requires exact source-bound approval and emits an immutable receipt', async () => {
    const { root, executable, definition } = await fixture();
    const plan = await createSetupActionPlan(definition, { installationId: 'a'.repeat(32), installationPrefix: root }, 'frozen-offline');
    await expect(executeSetupAction(plan, `sha256:${'0'.repeat(64)}`, { receiptsRoot: join(root, 'receipts'), runner: async () => {
      throw new Error('must not execute');
    } })).rejects.toMatchObject({ code: 'MOD_TRANSACTION_CONFLICT' });
    const receipt = await executeSetupAction(plan, plan.planHash, {
      receiptsRoot: join(root, 'receipts'),
      runner: async (request) => {
        expect(request.executable).toBe(executable);
        expect(request.args).toEqual(['--isolated']);
        return { exitCode: 0, signal: null, stdout: '', stderr: '', timedOut: false, outputTruncated: false };
      },
    });
    expect(receipt.outcome).toBe('passed');
    expect(JSON.parse(await readFile(join(root, 'receipts', `${receipt.receiptId}.json`), 'utf8')).planHash).toBe(plan.planHash);
  });

  it('rolls back only declared outputs when execution fails', async () => {
    const { root, definition } = await fixture();
    const plan = await createSetupActionPlan(definition, { installationId: 'a'.repeat(32), installationPrefix: root }, 'online');
    const output = join(root, 'state', 'python');
    await expect(executeSetupAction(plan, plan.planHash, {
      receiptsRoot: join(root, 'receipts'),
      runner: async () => {
        await mkdir(output, { recursive: true });
        await writeFile(join(output, 'partial'), 'partial');
        return { exitCode: 1, signal: null, stdout: '', stderr: 'failed', timedOut: false, outputTruncated: false };
      },
    })).rejects.toMatchObject({ code: 'MOD_TRANSACTION_FAILED' });
    await expect(stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await stat(join(root, 'bin', 'setup.js'))).toBeTruthy();
  });

  it('rejects changed executables, escaping outputs and network work offline', async () => {
    const { root, executable, definition } = await fixture();
    await expect(createSetupActionPlan({ ...definition, declaredOutputs: ['../escape'] }, { installationId: 'a'.repeat(32), installationPrefix: root }, 'online'))
      .rejects.toThrow('escapes');
    await expect(createSetupActionPlan({ ...definition, requiresNetwork: true }, { installationId: 'a'.repeat(32), installationPrefix: root }, 'frozen-offline'))
      .rejects.toThrow('unavailable');
    const plan = await createSetupActionPlan(definition, { installationId: 'a'.repeat(32), installationPrefix: root }, 'online');
    await writeFile(executable, 'changed');
    await expect(executeSetupAction(plan, plan.planHash, { receiptsRoot: join(root, 'receipts') }))
      .rejects.toThrow('changed after approval');
  });
});
