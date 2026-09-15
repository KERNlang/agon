import assert from 'node:assert/strict';

// Accept a built/installed public package entrypoint. No provider or personal state.
const { createMod } = await import(process.argv[2]);
const context = { invocationId: 'output-fixture', cwd: process.cwd(), platform: `${process.platform}-${process.arch}`, signal: new AbortController().signal, config: {} };
const services = {
  engines: { listActive: async () => ['fixture'], dispatch: async () => { throw new Error('unexpected provider dispatch'); } },
  receipts: { record: async () => 'fixture' },
  runs: { start: async () => ({ path: '/fixture/run', startedAt: 'fixture' }), finish: async () => {} },
  brainstorm: { open: () => ({
    readRatings: () => ({ byMode: { brainstorm: {} }, global: {} }), seed: () => {},
    preflight: async () => ({ healthy: ['fixture'], skipped: [] }),
    createLogger: () => ({ log: () => {} }), buildPrompt: () => 'fixture prompt',
    parseDraft: () => ({ approach: 'fixture approach', reasoning: 'fixture reasoning', confidence: 70, steps: [], tradeoffs: [], keyFiles: [] }),
    deduplicate: async () => ({ groups: null, status: { status: 'not-needed' } }), updateRatings: () => {},
    selectSeat: () => async () => ({ engineId: 'fixture', ok: true, text: 'fixture draft', attempts: 1 }),
    selectWinner: () => async () => ({ exitCode: 0, stdout: 'fixture answer' }),
  }) },
};
let command;
const registrar = new Proxy({}, { get: (_, key) => (...args) => {
  if (key === 'command' && args[0] === 'cli') command = args[1];
  return () => {};
} });
const dispose = await (await createMod(services)).activate(registrar);
try {
  const quiet = await command.run({ question: 'fixture question', quiet: true }, context);
  assert.equal(quiet.exitCode, 0);
  assert.equal(quiet.stdout, '/fixture/run\nAGON_SUMMARY: 1/1 succeeded\n');
  const human = await command.run({ question: 'fixture question' }, context);
  assert.match(human.stdout, /Engine\tQuality\tConfidence\tReasoning/);
  assert.match(human.stdout, /Response from fixture\nfixture answer/);
  assert.deepEqual(human.result, quiet.result);
  console.log('Brainstorm public CLI contribution: quiet and human output PASS');
} finally { await dispose(); }
