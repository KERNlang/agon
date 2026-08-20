import { readFileSync, writeFileSync } from 'node:fs';

import { scanText, cleanText, scanMetadata, stripMetadata, EngineRegistry, loadConfig, createRunDir, writeRunStatus } from '@kernlang/agon-core';

import type { RunStatus } from '@kernlang/agon-core';

import { resolveBuiltinEnginesDir } from '../lib/engines-dir.js';

import { createCliAdapter } from '@kernlang/agon-adapter-cli';

import { runNaturalize } from '@kernlang/agon-forge';

import { filterDefaultOrchestrationEngines } from './engine-filter.js';

import type { Dispatch, HandlerContext } from '../../handlers/types.js';

export async function handleSanitize(input: string, dispatch: Dispatch, ctx: HandlerContext): Promise<void> {
  // Parse: /sanitize [file] [--detect] [--metadata] [--strip] [--out <f>] [--in-place]
  let rest = input.trim();
  let file: string | undefined;
  let out: string | undefined;
  let detect = false;
  let metadata = false;
  let strip = false;
  let inPlace = false;
  const outM = rest.match(/(?:--out|-o)\s+(\S+)/);
  if (outM) { out = outM[1]; rest = rest.replace(outM[0], ' '); }
  if (/--detect\b/.test(rest)) { detect = true; rest = rest.replace(/--detect\b/, ' '); }
  if (/--metadata\b/.test(rest)) { metadata = true; rest = rest.replace(/--metadata\b/, ' '); }
  if (/--strip\b|--strip-metadata\b/.test(rest)) { strip = true; rest = rest.replace(/--strip(-metadata)?\b/, ' '); }
  if (/--in-place\b/.test(rest)) { inPlace = true; rest = rest.replace(/--in-place\b/, ' '); }
  const tail = rest.trim();
  if (tail) file = tail;
  
  if (!file) {
    dispatch({ type: 'warning', message: 'Usage: /sanitize <file> [--detect] [--metadata] [--strip] [--out <file>] [--in-place] — stdin is not available in the TUI; pass a file path.' });
    return;
  }
  
  if (metadata || strip) {
    let buf: Buffer;
    try {
      buf = readFileSync(file);
    } catch (err) {
      dispatch({ type: 'error', message: `Cannot read ${file}: ${err instanceof Error ? err.message : String(err)}` });
      return;
    }
    const report = scanMetadata(buf);
    dispatch({ type: 'header', title: `Sanitize (metadata): ${file} [${report.format}]` });
    if (report.format === 'unknown') {
      dispatch({ type: 'info', message: 'Unrecognized file format — no metadata scan performed.' });
    } else if (report.findings.length === 0) {
      dispatch({ type: 'success', message: 'No provenance metadata found (no C2PA manifest, XMP packet, or Exif block).' });
    } else {
      dispatch({
        type: 'table',
        headers: ['Offset', 'Channel', 'Bytes', 'Detail'],
        rows: report.findings.slice(0, 50).map((f) => [String(f.offset), f.channel, String(f.length), f.detail.slice(0, 60)]),
      });
    }
    dispatch({ type: 'info', message: `Not assessable: ${report.notAssessable.join('; ')}` });
    if (!strip) return;
    if (report.format === 'unknown' || report.findings.length === 0) {
      dispatch({ type: 'info', message: 'Nothing to strip.' });
      return;
    }
    if (!out && !inPlace) {
      dispatch({ type: 'error', message: 'Refusing to strip without a destination: pass --out <file> or --in-place. (Stripping provenance is destructive and breaks the C2PA signature.)' });
      return;
    }
    const stripped = stripMetadata(buf);
    const verify = scanMetadata(stripped.output);
    if (!verify.clean) {
      dispatch({ type: 'error', message: 'Internal error: stripped output still has provenance findings — refusing to emit.' });
      return;
    }
    const dest = inPlace ? file : out!;
    writeFileSync(dest, stripped.output);
    dispatch({ type: 'success', message: `Stripped ${report.findings.length} provenance block(s) → ${dest} (verified by re-scan).` });
    dispatch({ type: 'info', message: 'Honesty note: metadata removed — the C2PA signature is broken; absence of metadata is not proof of human origin.' });
    return;
  }
  
  let inputText: string;
  try {
    inputText = readFileSync(file, 'utf8');
  } catch (err) {
    dispatch({ type: 'error', message: `Cannot read ${file}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  const report = scanText(inputText);
  dispatch({ type: 'header', title: `Sanitize: ${file}` });
  if (report.findings.length === 0) {
    dispatch({ type: 'success', message: 'No hidden channels found — text is provably clean at the character level.' });
  } else {
    dispatch({
      type: 'table',
      headers: ['Channel', 'Count'],
      rows: Object.entries(report.byChannel).map(([channel, count]) => [channel, String(count)]),
    });
    dispatch({
      type: 'table',
      headers: ['Offset', 'Channel', 'Codepoint', 'Action', 'Detail'],
      rows: report.findings.slice(0, 50).map((f) => [String(f.offset), f.channel, f.hex || f.codepoint, f.action, f.detail.slice(0, 50)]),
    });
    if (report.findings.length > 50) dispatch({ type: 'info', message: `… and ${report.findings.length - 50} more findings` });
  }
  dispatch({ type: 'info', message: `Not assessable: ${report.notAssessable.join('; ')}` });
  if (detect) {
    dispatch({ type: report.clean ? 'success' : 'warning', message: report.clean ? '--detect: clean' : '--detect: actionable findings present' });
    return;
  }
  const cleaned = cleanText(inputText);
  const verify = scanText(cleaned.output);
  if (!verify.clean) {
    dispatch({ type: 'error', message: 'Internal error: cleaned output still has actionable findings — refusing to emit.' });
    return;
  }
  if (out) {
    writeFileSync(out, cleaned.output, 'utf8');
    dispatch({ type: 'success', message: `Cleaned output written to ${out} (${report.findings.length} finding(s) addressed, verified by re-scan).` });
  } else if (report.findings.length > 0) {
    dispatch({ type: 'info', message: 'Cleaned output not written — pass --out <file> to save it.' });
  }
}

export async function handleNaturalize(input: string, dispatch: Dispatch, ctx: HandlerContext): Promise<void> {
  // Parse: /naturalize <file> [--engine X] [--author Y] [--min-change N] [--max-attempts N] [--out <f>]
  let rest = input.trim();
  let file: string | undefined;
  let out: string | undefined;
  let engine: string | undefined;
  let author: string | undefined;
  let minChange: number | undefined;
  let maxAttempts = 2;
  const outM = rest.match(/(?:--out|-o)\s+(\S+)/);
  if (outM) { out = outM[1]; rest = rest.replace(outM[0], ' '); }
  const engM = rest.match(/--engine\s+(\S+)/);
  if (engM) { engine = engM[1]; rest = rest.replace(engM[0], ' '); }
  const authM = rest.match(/--author\s+(\S+)/);
  if (authM) { author = authM[1]; rest = rest.replace(authM[0], ' '); }
  const minM = rest.match(/--min-change\s+(\S+)/);
  if (minM) {
    const pct = Number(minM[1]);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      dispatch({ type: 'error', message: `Invalid --min-change '${minM[1]}' — expected a number 0-100 (0 disables the threshold).` });
      return;
    }
    minChange = pct > 0 ? pct / 100 : undefined;
    rest = rest.replace(minM[0], ' ');
  }
  const maxM = rest.match(/--max-attempts\s+(\d+)/);
  if (maxM) { maxAttempts = Math.max(1, parseInt(maxM[1], 10) || 2); rest = rest.replace(maxM[0], ' '); }
  const tail = rest.trim();
  if (tail) file = tail;
  
  if (!file) {
    dispatch({ type: 'warning', message: 'Usage: /naturalize <file> [--author X] [--engine Y] [--min-change N] [--max-attempts N] [--out <file>] — stdin is not available in the TUI; pass a file path.' });
    return;
  }
  
  let inputText: string;
  try {
    inputText = readFileSync(file, 'utf8');
  } catch (err) {
    dispatch({ type: 'error', message: `Cannot read ${file}: ${err instanceof Error ? err.message : String(err)}` });
    return;
  }
  if (!inputText.trim()) {
    dispatch({ type: 'error', message: 'No input text to naturalize.' });
    return;
  }
  
  const config = loadConfig();
  const registry = new EngineRegistry();
  registry.load(resolveBuiltinEnginesDir());
  const adapter = createCliAdapter(registry);
  const active = filterDefaultOrchestrationEngines(registry.activeIds(config as any));
  const authorId = author ? registry.resolveId(author) : undefined;
  const candidates = authorId ? active.filter((id) => id !== authorId) : active;
  const engineId = engine ? registry.resolveId(engine) : candidates[0];
  if (!engineId) {
    dispatch({ type: 'error', message: authorId
      ? `No active engines other than the author '${authorId}'. Add one with \`agon engine add <id>\`.`
      : 'No active engines. Run `agon engine list` or `agon engine add <id>`.' });
    return;
  }
  
  dispatch({ type: 'header', title: `Naturalize: ${file} · rewriter ${engineId}${authorId ? ` (author: ${authorId})` : ''}${minChange !== undefined ? ` · min-change ${Math.round(minChange * 100)}%` : ''}` });
  dispatch({ type: 'spinner-start', message: `Naturalizing with ${engineId}…` });
  
  const startedAt = new Date().toISOString();
  const { path: outputDir } = createRunDir({ mode: 'naturalize', label: undefined, announce: false });
  try {
    const result = await runNaturalize({
      input: inputText,
      engineId,
      registry,
      adapter,
      author: authorId,
      timeout: 120,
      outputDir,
      cwd: process.cwd(),
      minChange,
      maxAttempts,
    });
    dispatch({ type: 'spinner-stop' });
  
    const status: RunStatus = {
      mode: 'naturalize',
      label: undefined,
      startedAt,
      endedAt: new Date().toISOString(),
      engines: [{
        id: engineId,
        status: result.ok ? 'ok' : 'error',
        detail: result.ok
          ? `${result.changedWords} word(s) changed (${Math.round((1 - result.unchangedRatio) * 100)}% lexical change)`
          : (result.error ?? 'naturalize failed'),
      }],
      summary: result.ok
        ? `${engineId}: naturalized (${result.initialFindings} initial finding(s), ${result.changedWords} word(s) changed)`
        : `${engineId}: ${result.error ?? 'naturalize failed'}`,
      ok: result.ok,
      requested: [engineId],
      timeoutSec: 120,
    };
    writeRunStatus(outputDir, status);
  
    if (!result.ok) {
      dispatch({ type: 'error', message: result.error ?? 'Naturalize failed.' });
      return;
    }
  
    dispatch({ type: 'success', message: `Re-scan clean — no character-level hidden channels in the rewrite${result.rewriteCleaned ? ' (engine re-introduced channels; deterministically cleaned again)' : ''}.` });
    dispatch({ type: 'info', message: `Diff: ${result.wordsBefore} → ${result.wordsAfter} words, ${result.changedWords} changed (${Math.round((1 - result.unchangedRatio) * 100)}% lexical change)${result.attempts > 1 ? ` over ${result.attempts} attempts` : ''}.` });
    if (result.minChangeMet === true) {
      dispatch({ type: 'success', message: `Lexical-change threshold met (≥ ${Math.round((minChange ?? 0) * 100)}%) — original token stream destroyed; a keyed statistical watermark is very unlikely to survive.` });
    }
    dispatch({ type: 'info', message: `Residual / not assessable: ${result.residualNotAssessable.join('; ')}` });
    if (out) {
      writeFileSync(out, result.output, 'utf8');
      dispatch({ type: 'success', message: `Naturalized output written to ${out}.` });
    } else {
      dispatch({ type: 'engine-block', engineId, color: 2, content: result.output } as any);
    }
  } catch (err) {
    dispatch({ type: 'spinner-stop' });
    dispatch({ type: 'error', message: `Naturalize failed: ${err instanceof Error ? err.message : String(err)}` });
  }
}
