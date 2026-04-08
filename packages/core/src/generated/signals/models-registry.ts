// @kern-source: models-registry:1
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync } from 'node:fs';

// @kern-source: models-registry:2
import { join } from 'node:path';

// @kern-source: models-registry:3
import { homedir } from 'node:os';

// @kern-source: models-registry:5
export interface ModelsDevModel {
  id: string;
  name: string;
  family?: string;
  tool_call?: boolean;
  reasoning?: boolean;
  attachment?: boolean;
  cost?: {input:number, output:number};
  limit?: {context:number, output:number};
  provider?: {npm?:string, api?:string};
}

// @kern-source: models-registry:16
export interface ModelsDevProvider {
  id: string;
  name: string;
  npm: string;
  env: string[];
  api?: string;
  doc?: string;
  models: Record<string, ModelsDevModel>;
}

// @kern-source: models-registry:25
export interface ModelEntry {
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  baseUrl: string;
  apiKeyEnv: string;
  format: 'openai'|'anthropic';
  contextWindow?: number;
  costInput?: number;
  costOutput?: number;
  toolCall?: boolean;
}

// @kern-source: models-registry:38
export const CACHE_DIR: string = join(homedir(), '.agon', 'cache');

// @kern-source: models-registry:43
export const CACHE_FILE: string = join(CACHE_DIR, 'models-dev.json');

// @kern-source: models-registry:48
export const CACHE_TTL_MS: number = 3600000;

// @kern-source: models-registry:50
export const MODELS_DEV_URL: string = 'https://models.dev/api.json';

// @kern-source: models-registry:55
export async function fetchModelsRegistry(): Promise<Record<string, ModelsDevProvider>> {
  // Check cache first
  if (existsSync(CACHE_FILE)) {
    try {
      const stat = statSync(CACHE_FILE);
      const age = Date.now() - stat.mtimeMs;
      if (age < CACHE_TTL_MS) {
        return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
      }
    } catch (_e) { console.warn(`[agon] models-registry: cache read failed, refetching: ${_e instanceof Error ? _e.message : String(_e)}`); }
  }
  
  // Fetch from models.dev
  const response = await fetch(MODELS_DEV_URL);
  if (!response.ok) {
    // If fetch fails and cache exists (even stale), use it
    if (existsSync(CACHE_FILE)) {
      return JSON.parse(readFileSync(CACHE_FILE, 'utf-8'));
    }
    throw new Error(`Failed to fetch models registry: ${response.status}`);
  }
  
  const data = await response.json() as Record<string, ModelsDevProvider>;
  
  // Write cache
  mkdirSync(CACHE_DIR, { recursive: true });
  writeFileSync(CACHE_FILE, JSON.stringify(data));
  
  return data;
}

// @kern-source: models-registry:87
export function resolveModelFormat(providerNpm: string, model?: ModelsDevModel): 'openai'|'anthropic' {
  // Model-level override takes precedence
  const npm = model?.provider?.npm ?? providerNpm;
  if (npm.includes('anthropic')) return 'anthropic';
  return 'openai';
}

// @kern-source: models-registry:95
export function resolveBaseUrl(provider: ModelsDevProvider, model?: ModelsDevModel): string|null {
  // Model-level override
  if (model?.provider?.api) return model.provider.api;
  // Provider-level
  return provider.api ?? null;
}

// @kern-source: models-registry:103
export function buildModelEntries(registry: Record<string, ModelsDevProvider>): ModelEntry[] {
  const entries: ModelEntry[] = [];
  
  for (const provider of Object.values(registry)) {
    for (const model of Object.values(provider.models)) {
      const format = resolveModelFormat(provider.npm, model);
      const baseUrl = resolveBaseUrl(provider, model);
      if (!baseUrl) continue; // Skip providers without API URL
  
      const apiKeyEnv = provider.env[0];
      if (!apiKeyEnv) continue;
  
      entries.push({
        providerId: provider.id,
        providerName: provider.name,
        modelId: model.id,
        modelName: model.name,
        baseUrl,
        apiKeyEnv,
        format,
        contextWindow: model.limit?.context,
        costInput: model.cost?.input,
        costOutput: model.cost?.output,
        toolCall: model.tool_call,
      });
    }
  }
  
  // Sort by provider name, then model name
  entries.sort((a, b) => {
    const provCmp = a.providerName.localeCompare(b.providerName);
    if (provCmp !== 0) return provCmp;
    return a.modelName.localeCompare(b.modelName);
  });
  
  return entries;
}

// @kern-source: models-registry:142
export function searchModels(entries: ModelEntry[], query: string): ModelEntry[] {
  if (!query.trim()) return entries;
  const q = query.toLowerCase();
  const terms = q.split(/\s+/);
  
  return entries.filter((entry) => {
    const haystack = `${entry.providerName} ${entry.modelName} ${entry.modelId}`.toLowerCase();
    return terms.every((term: string) => haystack.includes(term));
  });
}

// @kern-source: models-registry:154
export function normalizeBaseUrl(url: string): string {
  // Strip /anthropic/ path segments — our apiDispatch uses OpenAI format only
  return url.replace(/\/anthropic(\/|$)/, '$1');
}

// @kern-source: models-registry:160
export function modelEntryToEngineDef(entry: ModelEntry): Record<string, any> {
  return {
    schemaVersion: 3,
    id: `${entry.providerId}-${entry.modelId}`.replace(/[^a-zA-Z0-9._-]/g, '-').toLowerCase(),
    displayName: `${entry.providerName} — ${entry.modelName}`,
    isLocal: false,
    tier: 'user',
    timeout: 180,
    exec: { args: [] },
    review: { args: [] },
    api: {
      baseUrl: normalizeBaseUrl(entry.baseUrl),
      apiKeyEnv: entry.apiKeyEnv,
      model: entry.modelId,
      maxTokens: Math.min(entry.contextWindow ? Math.floor(entry.contextWindow / 4) : 4096, 16384),
      format: entry.format ?? 'openai',
    },
  };
}

