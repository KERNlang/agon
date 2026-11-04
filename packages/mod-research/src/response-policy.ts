import type { Intent as ResearchIntent } from './implementation.js';

export interface ResearchSearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * Normalize a first-party JSON response to ResearchSearchResult[] per intent (npm/GitHub/Wikipedia/MDN/IETF/Stack Overflow). Defensive: returns [] on malformed payloads, a shape mismatch, or an intent with no keyless lane — so a drifted endpoint degrades to a clean fall-through rather than emitting garbage.
 */
export function parseAuthoritativeResults(intent: ResearchIntent, raw: string): ResearchSearchResult[] {
  let data: any;
  try { data = JSON.parse(raw); } catch { return []; }
  const stripTags = (s: string): string => String(s ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;|&#x27;|&rsquo;|&lsquo;/gi, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();

  if (intent === 'package') {
    const objs = Array.isArray(data?.objects) ? data.objects : [];
    return objs.map((o: any) => {
      const p = o?.package ?? {};
      const name = String(p?.name ?? '');
      const url = String(p?.links?.npm ?? p?.links?.homepage ?? (name ? `https://www.npmjs.com/package/${name}` : ''));
      return { title: name, url, snippet: String(p?.description ?? '') };
    }).filter((r: ResearchSearchResult) => r.url);
  }
  if (intent === 'github') {
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.map((i: any) => ({
      title: String(i?.full_name ?? ''),
      url: String(i?.html_url ?? ''),
      snippet: String(i?.description ?? ''),
    })).filter((r: ResearchSearchResult) => r.url);
  }
  if (intent === 'fact') {
    const pages = Array.isArray(data?.pages) ? data.pages : [];
    return pages.map((pg: any) => {
      const key = String(pg?.key ?? '');
      return {
        title: String(pg?.title ?? ''),
        url: key ? `https://en.wikipedia.org/wiki/${encodeURIComponent(key)}` : '',
        snippet: stripTags(String(pg?.description ?? pg?.excerpt ?? '')),
      };
    }).filter((r: ResearchSearchResult) => r.url);
  }
  if (intent === 'standard') {
    // MDN search → { documents: [{ mdn_url, title, summary }] }
    const docs = Array.isArray(data?.documents) ? data.documents : [];
    return docs.map((d: any) => {
      const slug = String(d?.mdn_url ?? '');
      const url = slug ? (slug.startsWith('http') ? slug : `https://developer.mozilla.org${slug}`) : '';
      return { title: String(d?.title ?? ''), url, snippet: stripTags(String(d?.summary ?? '')) };
    }).filter((r: ResearchSearchResult) => r.url);
  }
  if (intent === 'rfc') {
    // IETF datatracker → { objects: [{ name, title }] }
    const objs = Array.isArray(data?.objects) ? data.objects : [];
    return objs.map((o: any) => {
      const name = String(o?.name ?? '');
      const title = String(o?.title ?? '');
      return {
        title: (name ? name.toUpperCase() : title) + (name && title ? ` — ${title}` : ''),
        url: name ? `https://datatracker.ietf.org/doc/${encodeURIComponent(name)}/` : '',
        snippet: title || stripTags(String(o?.abstract ?? '')),
      };
    }).filter((r: ResearchSearchResult) => r.url);
  }
  if (intent === 'qa') {
    // Stack Exchange → { items: [{ title, link, score, is_answered }] }
    const items = Array.isArray(data?.items) ? data.items : [];
    return items.map((it: any) => ({
      title: stripTags(String(it?.title ?? '')),
      url: String(it?.link ?? ''),
      snippet: `${it?.is_answered ? 'answered' : 'unanswered'} · score ${Number(it?.score ?? 0)}`,
    })).filter((r: ResearchSearchResult) => r.url);
  }
  return [];
}
