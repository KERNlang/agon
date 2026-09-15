import assert from 'node:assert/strict';

// Accept a built/installed public package entrypoint. No provider or personal state.
const { createMod } = await import(process.argv[2]);
const context = { invocationId: 'output-fixture', cwd: process.cwd(), platform: `${process.platform}-${process.arch}`, signal: new AbortController().signal, config: {} };
let streamed;
const services = {
  engines: { listActive: async () => ['fixture'], dispatch: async () => { throw new Error('unexpected provider dispatch'); } },
  receipts: { record: async () => 'fixture' },
  runs: { start: async () => ({ path: '/fixture/run', startedAt: 'fixture' }), finish: async () => {} },
  brainstorm: { open: () => ({
    readRatings: () => ({ byMode: { brainstorm: {} }, global: {} }), seed: () => {},
    preflight: async () => {
      if (streamed) assert.match(streamed[0], /\/fixture\/run\n$/);
      return { healthy: ['fixture'], skipped: [] };
    },
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
  services.brainstorm.writeCliOutput = chunk => { streamed.push(chunk); };
  streamed = [];
  const live = await command.run({ question: 'fixture question' }, context);
  assert.equal(streamed[0], 'AGON_RUN: /fixture/run\n');
  assert.match(streamed.join(''), /OK fixture: 1 attempt\(s\)/);
  assert.doesNotMatch(live.stdout, /AGON_RUN/);
  streamed = [];
  const liveQuiet = await command.run({ question: 'fixture question', quiet: true }, context);
  assert.deepEqual(streamed, ['/fixture/run\n']);
  assert.equal(liveQuiet.stdout, 'AGON_SUMMARY: 1/1 succeeded\n');
  console.log('Brainstorm public CLI contribution: buffered and streaming human/quiet output PASS');
} finally { await dispose(); }
