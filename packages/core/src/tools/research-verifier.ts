import { parseAndValidateUrl, htmlToText } from './tool-web-fetch.js';
import { judgeProbe } from '@kernlang/agon-mod-research/citation-policy';
import type { CitationProbe, CitationVerdict, CitationReport } from '@kernlang/agon-mod-research/citation-policy';

export { extractCitations, judgeProbe, formatCitationReport } from '@kernlang/agon-mod-research/citation-policy';
export type { CitationStatus, CitationProbe, CitationVerdict, CitationReport } from '@kernlang/agon-mod-research/citation-policy';

/**
 * SSRF-guarded liveness probe of one citation URL. Follows redirects by hand (each hop re-validated like WebFetch), flags a redirect that lands on a different host, and reads a small (16 KiB) text sample for relevance checking. Never throws — failures come back as ok:false with a reason. Honors a caller AbortSignal.
 */
export async function probeCitation(url: string, timeoutMs?: number, signal?: AbortSignal): Promise<CitationProbe> {
  const v = parseAndValidateUrl(String(url ?? ''));
  if (!v.ok || !v.url) {
    return { url: String(url ?? ''), ok: false, status: 0, finalUrl: '', crossHostRedirect: false, sample: '', error: v.reason ?? 'invalid URL' };
  }
  const normHost = (h: string): string => h.toLowerCase().replace(/^www\./, '');
  let startHost = '';
  try { startHost = normHost(new URL(v.url).hostname); } catch { /* validated above */ }

  const MAX_REDIRECTS = 5;
  const MAX_BYTES = 16 * 1024; // a small relevance sample — not the whole page
  const HEADERS = { 'user-agent': 'agon-research/0.1 (+https://github.com/KERNlang/agon)', accept: 'text/html,text/plain,application/json;q=0.9,*/*;q=0.5' };

  const controller = new AbortController();
  const ms = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : 10000;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, ms);
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  try {
    // Caller already cancelled — bail before any network I/O.
    if (controller.signal.aborted) {
      return { url: v.url, ok: false, status: 0, finalUrl: v.url, crossHostRedirect: false, sample: '', error: signal?.aborted ? 'probe aborted by caller' : 'probe aborted' };
    }
    let currentUrl = v.url;
    let crossHost = false;
    let res: Response | null = null;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      res = await fetch(currentUrl, { signal: controller.signal, redirect: 'manual', headers: HEADERS });
      const loc = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && loc) {
        let next: string;
        try { next = new URL(loc, currentUrl).toString(); } catch { break; }
        const rv = parseAndValidateUrl(next);
        if (!rv.ok || !rv.url) {
          return { url: v.url, ok: false, status: res.status, finalUrl: currentUrl, crossHostRedirect: crossHost, sample: '', error: `blocked redirect → ${rv.reason ?? next}` };
        }
        try { if (normHost(new URL(rv.url).hostname) !== startHost) crossHost = true; } catch { /* keep prior */ }
        currentUrl = rv.url;
        res = null;
        continue;
      }
      break;
    }
    if (!res) {
      return { url: v.url, ok: false, status: 0, finalUrl: currentUrl, crossHostRedirect: crossHost, sample: '', error: `too many redirects (> ${MAX_REDIRECTS})` };
    }
    // A leftover 3xx (broke out on a malformed Location, or ran out of hops)
    // is not a usable final response — report it as unverifiable rather than
    // claiming ok:true with a redirect status.
    if (res.status >= 300 && res.status < 400) {
      return { url: v.url, ok: false, status: res.status, finalUrl: currentUrl, crossHostRedirect: crossHost, sample: '', error: `unresolved redirect (HTTP ${res.status})` };
    }

    let sample = '';
    if (res.ok && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let received = 0;
      let raw = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          received += value.byteLength;
          raw += decoder.decode(value, { stream: true });
          if (received > MAX_BYTES) { await reader.cancel(); break; }
        }
      }
      raw += decoder.decode();
      const ct = res.headers.get('content-type') ?? '';
      sample = /html/i.test(ct) ? htmlToText(raw, 4000) : raw.slice(0, 4000);
    }
    return { url: v.url, ok: true, status: res.status, finalUrl: currentUrl, crossHostRedirect: crossHost, sample };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      url: v.url,
      ok: false,
      status: 0,
      finalUrl: v.url,
      crossHostRedirect: false,
      sample: '',
      error: timedOut ? `probe timed out after ${ms}ms` : (signal?.aborted ? 'probe aborted by caller' : `probe failed: ${msg}`),
    };
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
  }
}

/**
 * Probe every citation URL (bounded concurrency, default 4 / hard max 8), judge each, and summarize verified / blocked / rejected. `blocked` (access-denied/rate-limited re-fetches) is counted separately from `rejected` (genuinely-bad) because it does not disprove the citation. Order of results matches the input order. Honors a caller AbortSignal — an already-aborted signal yields all-unreachable verdicts without network I/O.
 */
export async function verifyCitations(urls: string[], claimTerms?: string[], concurrency?: number, signal?: AbortSignal): Promise<CitationReport> {
  const list = (Array.isArray(urls) ? urls : []).filter((u) => typeof u === 'string' && u.trim());
  const limit = typeof concurrency === 'number' && concurrency > 0 ? Math.min(concurrency, 8) : 4;
  const results: CitationVerdict[] = [];
  let i = 0;
  const worker = async (): Promise<void> => {
    while (i < list.length) {
      const idx = i++;
      try {
        const probe = await probeCitation(list[idx], undefined, signal);
        results[idx] = judgeProbe(probe, claimTerms);
      } catch (e) {
        // probeCitation is contracted never to throw, but guarantee no holes
        // in results[] (and that Promise.all never rejects) even if it ever does.
        const msg = e instanceof Error ? e.message : String(e);
        results[idx] = { url: list[idx], verdict: 'unreachable', httpStatus: 0, finalUrl: list[idx], detail: msg };
      }
    }
  };
  const workers = Array.from({ length: Math.min(limit, list.length) }, () => worker());
  await Promise.all(workers);
  const final = results.filter(Boolean);
  const verified = final.filter((r) => r.verdict === 'verified').length;
  const blocked = final.filter((r) => r.verdict === 'blocked').length;
  return { total: list.length, verified, blocked, rejected: list.length - verified - blocked, results: final };
}
