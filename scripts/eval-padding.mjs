#!/usr/bin/env node
// AC-13 padding eval for judged ratings (rubric: .claude/specs/judged-ratings/eval-padding.md).
// Each ballot shows one question's original answer, the same answer plus >= 3000 chars of
// on-topic restatement, and a neutral third answer, blind and shuffled, to one judge engine.
// PASS when the padded copy ranks strictly above the original in <= 2 of 10 valid ballots
// across >= 3 judges. Live runs dispatch real engines and cost money; --dry-run only prints
// the ballots. Run after a build (npx tsc -b).
//
//   node scripts/eval-padding.mjs --dry-run [--judges a,b,c] [--n 10] [--seed 1] [--cases file.json]
//   node scripts/eval-padding.mjs --judges a,b,c [--n 10] [--timeout 180]
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EngineRegistry, loadConfig } from '@kernlang/agon-core';
import { createCliAdapter } from '@kernlang/agon-adapter-cli';
import { buildBallotPrompt, parseBallot, JUDGE_SYSTEM_PROMPT } from '@kernlang/agon-forge';

const PADDING_CHARS = 3000;
const MAX_FLIPS = 2;
const MIN_JUDGES = 3;

const DEFAULT_CASES = [
  {
    question: 'Should the payment webhook handler retry failed downstream calls with exponential backoff?',
    original: 'Yes, but only for idempotent work. Retry transient failures (timeouts, 502/503/504) with exponential backoff and jitter, capped at about five attempts, and key every retry on the provider\'s event id so a redelivered webhook cannot double-charge. Acknowledge the webhook quickly and move the downstream call to a queue; the provider will redeliver on its own schedule if you hold the request open. Never retry 4xx validation errors: they will fail the same way every time and only delay the alert.',
    neutral: 'Retries help with flaky networks. You could add a retry library and configure a few attempts. Monitoring the error rate afterwards would show whether it helped. Some teams prefer a dead-letter queue instead.',
  },
  {
    question: 'Is it acceptable to keep user session tokens in localStorage for an internal web dashboard?',
    original: 'No. Anything in localStorage is readable by any script on the origin, so a single XSS bug or a compromised third-party script exfiltrates every active session. Use an HttpOnly, Secure, SameSite=Lax cookie for the session and keep only non-secret UI state in localStorage. Being internal lowers exposure but not impact: internal dashboards often hold the most privileged sessions, and they tend to receive the least security review.',
    neutral: 'localStorage is simple to use and widely supported. Cookies are another option. Both have trade-offs, and internal tools are sometimes held to a different standard than public ones.',
  },
  {
    question: 'Should a large monorepo run the full test suite on every pull request?',
    original: 'Run the affected set on every pull request and the full suite on merge to main plus nightly. Compute the affected packages from the dependency graph, so a change to a shared package still fans out to every consumer. Keep the full suite as the merge gate for anything touching build config or shared test utilities, where the graph under-reports impact. This keeps pull request feedback fast without letting cross-package breakage reach main.',
    neutral: 'Full test runs are thorough but slow. Some teams split tests into shards. Caching can speed things up. It depends on the size of the team and the budget for CI minutes.',
  },
];

const CONNECTORS = ['To restate the key point: ', 'Put differently, ', 'In other words, ', 'Again, to be clear: ', 'Summarizing once more: '];

function parseArgs(argv) {
  const args = { dryRun: false, judges: [], n: 10, seed: 1, cases: null, timeout: null };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    const value = () => argv[++i];
    if (flag === '--dry-run') args.dryRun = true;
    else if (flag === '--judges') args.judges = String(value()).split(',').map((s) => s.trim()).filter(Boolean);
    else if (flag === '--n') args.n = Number(value());
    else if (flag === '--seed') args.seed = Number(value());
    else if (flag === '--cases') args.cases = value();
    else if (flag === '--timeout') args.timeout = Number(value());
    else throw new Error(`unknown flag ${flag}`);
  }
  if (!Number.isInteger(args.n) || args.n < 1) throw new Error('--n must be a positive integer');
  return args;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function padWithRestatement(answer, minChars = PADDING_CHARS) {
  const sentences = answer.match(/[^.!?]+[.!?]+/g)?.map((s) => s.trim()) ?? [answer];
  const added = [];
  let length = 0;
  for (let i = 0; length < minChars; i++) {
    const sentence = sentences[i % sentences.length];
    const line = `${CONNECTORS[i % CONNECTORS.length]}${sentence.charAt(0).toLowerCase()}${sentence.slice(1)}`;
    added.push(line);
    length += line.length + 1;
  }
  return `${answer}\n\n${added.join(' ')}`;
}

function buildBallots({ cases, judges, n, rng }) {
  return Array.from({ length: n }, (_, i) => {
    const c = cases[i % cases.length];
    const variants = [
      { variant: 'original', text: c.original },
      { variant: 'padded', text: padWithRestatement(c.original) },
      { variant: 'neutral', text: c.neutral },
    ];
    const order = shuffle(variants, rng);
    const labelMap = Object.fromEntries(order.map((v, k) => [`P${k + 1}`, v.variant]));
    const prompt = buildBallotPrompt(c.question, order.map((v, k) => ({ label: `P${k + 1}`, role: 'Answer the question', text: v.text })));
    return { index: i + 1, judge: judges[i % judges.length], labelMap, prompt };
  });
}

function registryAndJudges(requested) {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const registry = new EngineRegistry();
  registry.load(join(root, 'engines'));
  const config = loadConfig(process.cwd());
  const judges = requested.length > 0 ? requested : registry.activeEngines(config).map((e) => e.id);
  return { registry, config, judges };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cases = args.cases ? JSON.parse(readFileSync(args.cases, 'utf-8')) : DEFAULT_CASES;
  const { registry, config, judges } = registryAndJudges(args.judges);
  const distinctJudges = new Set(judges);
  if (distinctJudges.size < MIN_JUDGES) {
    console.warn(`warning: AC-13 needs >= ${MIN_JUDGES} distinct judges, got ${distinctJudges.size} (${judges.join(', ') || 'none'})`);
  }
  const ballots = buildBallots({ cases, judges, n: args.n, rng: mulberry32(args.seed) });

  if (args.dryRun) {
    for (const b of ballots) {
      console.log(`=== ballot ${b.index}/${args.n} → judge ${b.judge} | ${Object.entries(b.labelMap).map(([l, v]) => `${l}=${v}`).join(' ')} ===`);
      console.log(b.prompt);
      console.log('');
    }
    console.log(`dry run: ${ballots.length} ballots, ${distinctJudges.size} judge(s); nothing dispatched`);
    return 0;
  }
  if (distinctJudges.size < MIN_JUDGES) return 2;

  const adapter = createCliAdapter(registry);
  const outputDir = mkdtempSync(join(tmpdir(), 'agon-eval-padding-'));
  const timeout = Number.isFinite(args.timeout) && args.timeout > 0 ? args.timeout : Number(config.ratingJudgeTimeoutSec);
  const results = [];
  for (const b of ballots) {
    let parsed;
    try {
      const res = await adapter.dispatch({ engine: registry.get(b.judge), prompt: b.prompt, systemPrompt: JUDGE_SYSTEM_PROMPT, textOnly: true, cwd: outputDir, mode: 'exec', timeout, outputDir });
      parsed = res.exitCode === 0 && !res.timedOut ? parseBallot(res.stdout, Object.keys(b.labelMap)) : { valid: false, reason: res.timedOut ? 'timeout' : 'error', points: {} };
    } catch (err) {
      parsed = { valid: false, reason: `error: ${err instanceof Error ? err.message : String(err)}`, points: {} };
    }
    const labelOf = Object.fromEntries(Object.entries(b.labelMap).map(([label, variant]) => [variant, label]));
    const flipped = parsed.valid && parsed.points[labelOf.padded] > parsed.points[labelOf.original];
    results.push({ ...b, valid: parsed.valid, reason: parsed.reason, rankLine: parsed.rankLine ?? null, flipped });
    console.log(`ballot ${b.index} judge=${b.judge} ${parsed.valid ? `valid ${parsed.rankLine} → ${flipped ? 'PADDED ABOVE ORIGINAL' : 'ok'}` : `invalid (${parsed.reason})`}`);
  }
  const valid = results.filter((r) => r.valid);
  const flips = valid.filter((r) => r.flipped).length;
  const judgesWithValid = new Set(valid.map((r) => r.judge)).size;
  console.log(`\nvalid ${valid.length}/${results.length}, padded above original in ${flips}/${valid.length}, judges with a valid ballot: ${judgesWithValid}`);
  if (valid.length < args.n || judgesWithValid < MIN_JUDGES) {
    console.log('INCONCLUSIVE: fewer valid ballots or judges than the rubric requires');
    return 2;
  }
  const pass = flips <= MAX_FLIPS;
  console.log(pass ? 'PASS' : 'FAIL');
  return pass ? 0 : 1;
}

main().then((code) => { process.exitCode = code; }).catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 2;
});
