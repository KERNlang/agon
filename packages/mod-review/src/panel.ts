import type { EngineDescription, InvocationContext, Json, ModServices, RunRecordHandle } from '@kernlang/agon-mod-api';
import { join } from 'node:path';
import {
  routeReviewers,
  serializeReviewRoutingManifest,
  type ReviewRiskRequest,
  type ReviewRoutingEngine,
  type ReviewRoutingManifest,
} from '@kernlang/agon-support-verification';

type Input = Record<string, Json>;
type Rejected = { readonly error: string };

const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const RISKS: readonly ReviewRiskRequest[] = ['auto', 'low', 'medium', 'high'];
export const ROUTING_MANIFEST_FILE = 'review-routing.json';

export interface RoutedPanel {
  readonly engines: string[];
  readonly manifest: ReviewRoutingManifest;
  readonly identitiesVerifiable: boolean;
  readonly warnings: string[];
}

export function isExplicitPanel(input: Input): boolean {
  return input.engine !== undefined || input.engines !== undefined;
}

export async function resolveExplicitPanel(
  input: Input,
  context: InvocationContext,
  services: ModServices,
): Promise<string[] | Rejected> {
  if (input.engine !== undefined && input.engines !== undefined) {
    return { error: 'Use either --engine or --engines, not both.' };
  }
  const requested = input.engine !== undefined
    ? [text(input.engine)]
    : typeof input.engines === 'string' ? input.engines.split(',').map(text) : [];
  if (!requested.length || requested.some(id => !id)) {
    return { error: 'An explicit Review engine list cannot be empty.' };
  }
  try {
    if (services.engines.resolveRequested) {
      return [...await services.engines.resolveRequested(requested, context)];
    }
    let active: string[] = [];
  try {
    active = services.engines.listActive ? [...await services.engines.listActive(context)] : [];
  } catch (error) {
    return { error: `Could not list active engines: ${error instanceof Error ? error.message : String(error)}` };
  }
    const unknown = requested.filter(id => !active.includes(id));
    if (unknown.length) return { error: `Unknown or inactive review engines: ${unknown.join(', ')}` };
    return [...new Set(requested)];
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}

function toRoutingEngine(id: string, description: EngineDescription | undefined): ReviewRoutingEngine {
  if (!description) return { engine: { id }, backend: 'api' };
  return {
    engine: {
      id: description.id,
      ...(description.binary ? { binary: description.binary } : {}),
      ...(description.apiBaseUrl ? { api: { baseUrl: description.apiBaseUrl } } : {}),
    },
    backend: description.backend,
  };
}

async function describeEngines(
  ids: readonly string[],
  context: InvocationContext,
  services: ModServices,
): Promise<Map<string, EngineDescription> | string> {
  if (!services.engines.describe) return 'host cannot describe engines';
  try {
    const described = await services.engines.describe(ids, context);
    return new Map(described.map(entry => [entry.id, entry]));
  } catch (error) {
    return `engine describe failed: ${error instanceof Error ? error.message : String(error)}`;
  }
}

export async function routeReviewPanel(
  input: Input,
  diff: string,
  context: InvocationContext,
  services: ModServices,
): Promise<RoutedPanel | Rejected> {
  const risk = (text(input.risk) || 'auto').toLowerCase() as ReviewRiskRequest;
  if (!RISKS.includes(risk)) return { error: `Unknown review risk "${risk}". Use auto, low, medium, or high.` };
  const primaryId = text(input['primary-engine']);
  if (input['primary-engine'] !== undefined && !primaryId) {
    return { error: '--primary-engine cannot be empty. Omit it to widen automatic routing to high risk.' };
  }
  const active = services.engines.listActive ? [...await services.engines.listActive(context)] : [];
  const description = await describeEngines(primaryId ? [...new Set([...active, primaryId])] : active, context, services);
  const described = typeof description === 'string' ? undefined : description;
  if (described && primaryId && !described.has(primaryId)) {
    return { error: `Unknown --primary-engine "${primaryId}". Use a registered engine id, or omit the flag to widen to high risk.` };
  }
  const warnings = typeof description === 'string'
    ? [`${description}; adapter identities are unverifiable, so routing seats the full active roster`]
    : [];
  for (const warning of warnings) await services.logger?.warn(`review: ${warning}`);
  const manifest = routeReviewers(
    diff,
    risk,
    primaryId ? toRoutingEngine(primaryId, described?.get(primaryId)) : undefined,
    active.map(id => toRoutingEngine(id, described?.get(id))),
  );
  return { engines: manifest.selected.map(candidate => candidate.engineId), manifest, identitiesVerifiable: Boolean(described), warnings };
}

export function routingShortfallMessage(panel: RoutedPanel): string | undefined {
  const shortfall = panel.manifest.shortfall;
  if (!shortfall) return undefined;
  return `routing shortfall: ${shortfall.available}/${shortfall.required} independent adapter identities (${shortfall.reason})`;
}

export async function persistRoutingManifest(
  run: RunRecordHandle | undefined,
  panel: RoutedPanel,
  context: InvocationContext,
  services: ModServices,
): Promise<string | undefined> {
  if (!run || !services.runs) return undefined;
  await services.runs.writeArtifact(run, ROUTING_MANIFEST_FILE, serializeReviewRoutingManifest(panel.manifest), context);
  return join(run.path, ROUTING_MANIFEST_FILE);
}

export function routingSummary(panel: RoutedPanel, manifestPath: string | undefined): Json {
  const { manifest } = panel;
  return {
    risk: manifest.risk as unknown as Json,
    primary: manifest.primary?.engineId ?? null,
    selected: manifest.selected.map(candidate => candidate.engineId),
    excluded: manifest.excluded as unknown as Json,
    shortfall: manifest.shortfall as unknown as Json,
    identitiesVerifiable: panel.identitiesVerifiable,
    manifest: manifestPath ?? null,
  };
}
