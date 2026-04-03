import { writeFileSync, mkdirSync, unlinkSync, readdirSync, readFileSync, existsSync } from 'node:fs';

import { join } from 'node:path';

import { homedir } from 'node:os';

import type { Dispatch, HandlerContext } from '../handlers/types.js';

function enginesDir(): string {
  return join(homedir(), '.agon', 'engines');
}

export async function handleProviderAdd(dispatch: Dispatch, ctx: HandlerContext, args: string): Promise<void> {
  // Parse: /provider add <id> <baseUrl> <apiKeyEnv> <model>
  const parts = args.trim().split(/\s+/);
  if (parts.length < 4) {
    dispatch({ type: 'error', message: 'Usage: /provider add <id> <baseUrl> <API_KEY_ENV> <model>' });
    dispatch({ type: 'info', message: 'Example: /provider add minimax https://api.minimax.chat MINIMAX_API_KEY abab-7' });
    dispatch({ type: 'info', message: 'Example: /provider add groq https://api.groq.com/openai GROQ_API_KEY llama-3.3-70b-versatile' });
    dispatch({ type: 'info', message: 'Example: /provider add deepseek https://api.deepseek.com DEEPSEEK_API_KEY deepseek-chat' });
    return;
  }
  
  const [id, baseUrl, apiKeyEnv, ...modelParts] = parts;
  const model = modelParts.join(' ');
  
  // Check if API key is set
  if (!process.env[apiKeyEnv]) {
    dispatch({ type: 'warning', message: `${apiKeyEnv} is not set. Set it before using this provider.` });
  }
  
  const def = {
    schemaVersion: 3,
    id,
    displayName: id.charAt(0).toUpperCase() + id.slice(1),
    binary: '',
    searchPaths: [],
    versionCmd: [],
    isLocal: false,
    tier: 'user',
    timeout: 120,
    exec: { args: [] },
    review: { args: [] },
    api: { baseUrl, apiKeyEnv, model },
  };
  
  const dir = enginesDir();
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), JSON.stringify(def, null, 2) + '\n');
  
  // Register in current session
  ctx.registry.register(def as any);
  
  dispatch({ type: 'success', message: `Provider added: ${id} (${model})` });
  dispatch({ type: 'info', message: `API: ${baseUrl}` });
  dispatch({ type: 'info', message: `Key: ${apiKeyEnv}${process.env[apiKeyEnv] ? ' (set)' : ' (not set!)'}` });
  dispatch({ type: 'info', message: `Use: /use ${id}` });
}

export function handleProviderRemove(dispatch: Dispatch, ctx: HandlerContext, id: string): void {
  if (!id) {
    dispatch({ type: 'error', message: 'Usage: /provider remove <id>' });
    return;
  }
  const path = join(enginesDir(), `${id}.json`);
  if (!existsSync(path)) {
    dispatch({ type: 'error', message: `Provider "${id}" not found` });
    return;
  }
  unlinkSync(path);
  dispatch({ type: 'success', message: `Removed provider: ${id}` });
}

export function handleProviderList(dispatch: Dispatch): void {
  const dir = enginesDir();
  if (!existsSync(dir)) {
    dispatch({ type: 'info', message: 'No custom providers. Add one with /provider add' });
    return;
  }
  
  const files = readdirSync(dir).filter((f: string) => f.endsWith('.json'));
  if (files.length === 0) {
    dispatch({ type: 'info', message: 'No custom providers. Add one with /provider add' });
    return;
  }
  
  dispatch({ type: 'header', title: 'Custom Providers' });
  const rows: string[][] = [];
  for (const file of files) {
    try {
      const def = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
      if (def.api) {
        const hasKey = !!process.env[def.api.apiKeyEnv];
        rows.push([def.id, def.api.model, def.api.baseUrl, hasKey ? 'ready' : 'no key']);
      }
    } catch (_e) { /* skip malformed */ }
  }
  if (rows.length > 0) {
    dispatch({ type: 'table', headers: ['ID', 'Model', 'API URL', 'Status'], rows });
  }
  dispatch({ type: 'info', message: 'Add: /provider add <id> <baseUrl> <API_KEY_ENV> <model>' });
}

export async function handleProvider(action: string, args: string, dispatch: Dispatch, ctx: HandlerContext): Promise<void> {
  switch (action) {
    case 'add': return handleProviderAdd(dispatch, ctx, args);
    case 'remove': handleProviderRemove(dispatch, ctx, args.trim()); return;
    case 'list':
    default: handleProviderList(dispatch); return;
  }
}

