// @kern-source: handlers-info:1
import { readdirSync, readFileSync } from 'node:fs';

// @kern-source: handlers-info:2
import { join } from 'node:path';

// @kern-source: handlers-info:3
import { ensureAgonHome, RUNS_DIR, getElo, getEngineRating, tracker, loadConfig, configSet, DEFAULT_CONFIG, discoverEngines, addWorkspace, removeWorkspace, switchWorkspace, listWorkspaces, getActiveWorkspace, listChatSessions, loadChatSession } from '@agon/core';

// @kern-source: handlers-info:4
import type { AgonConfig, ForgeManifest } from '@agon/core';

// @kern-source: handlers-info:5
import type { Intent } from '../intent.js';

// @kern-source: handlers-info:6
import type { Dispatch, HandlerContext } from '../handlers/types.js';

// @kern-source: handlers-info:7
import { EngineRegistry } from '@agon/core';

// @kern-source: handlers-info:9
export function handleLeaderboard(dispatch: Dispatch): void {
  const elo = getElo();
  dispatch({ type: 'header', title: 'Global Leaderboard' });
  
  const rows = Object.entries(elo.global)
    .sort(([, a], [, b]) => b.rating - a.rating)
    .map(([id, r], i) => [
      `${i + 1}.`,
      id,
      String(r.rating),
      String(r.wins),
      String(r.losses),
      `${r.wins + r.losses > 0 ? Math.round((r.wins / (r.wins + r.losses)) * 100) : 0}%`,
    ]);
  
  if (rows.length === 0) {
    dispatch({ type: 'info', message: 'No matches recorded. Run a forge to start competing!' });
    return;
  }
  dispatch({ type: 'table', headers: ['#', 'Engine', 'ELO', 'W', 'L', 'Win%'], rows });
  
  const classes = Object.keys(elo.byTaskClass);
  if (classes.length > 0) {
    dispatch({ type: 'info', message: `Task classes with data: ${classes.join(', ')}` });
  }
}

// @kern-source: handlers-info:37
function showRunDetail(dispatch: Dispatch, id: string): void {
  let files: string[];
  try {
    files = readdirSync(RUNS_DIR).filter((f: string) => f.includes(id));
  } catch (err) {
    console.warn(`[agon] failed to read runs directory: ${err instanceof Error ? err.message : String(err)}`);
    dispatch({ type: 'info', message: `Run "${id}" not found` });
    return;
  }
  if (files.length === 0) {
    dispatch({ type: 'info', message: `Run "${id}" not found` });
    return;
  }
  
  const manifest = JSON.parse(readFileSync(join(RUNS_DIR, files[0]), 'utf-8')) as ForgeManifest;
  dispatch({ type: 'header', title: `Forge Run: ${manifest.forgeId.slice(0, 8)}` });
  dispatch({ type: 'text', content: `Task: ${manifest.task}\nFitness: ${manifest.fitnessCmd}\nDate: ${new Date(manifest.timestamp).toLocaleString()}\nWinner: ${manifest.winner ?? 'none'}` });
  
  if (Object.keys(manifest.results).length > 0) {
    dispatch({ type: 'header', title: 'Scores' });
    const rows = Object.entries(manifest.results).map(([eid, r]) => [
      eid === manifest.winner ? `★ ${eid}` : eid,
      r.pass ? 'PASS' : 'FAIL',
      String(r.score),
      String(r.diffLines),
      String(r.filesChanged),
      `${r.durationSec}s`,
    ]);
    dispatch({ type: 'table', headers: ['Engine', 'Status', 'Score', 'Diff', 'Files', 'Time'], rows });
  }
}

// @kern-source: handlers-info:70
export function handleHistory(dispatch: Dispatch, id?: string): void {
  ensureAgonHome();
  
  if (id) {
    showRunDetail(dispatch, id);
    return;
  }
  
  let files: string[];
  try {
    files = readdirSync(RUNS_DIR).filter((f: string) => f.endsWith('.json')).sort().reverse();
  } catch (err) {
    console.warn(`[agon] failed to list runs: ${err instanceof Error ? err.message : String(err)}`);
    dispatch({ type: 'info', message: 'No forge runs yet.' });
    return;
  }
  
  if (files.length === 0) {
    dispatch({ type: 'info', message: 'No forge runs yet.' });
    return;
  }
  
  const recent = files.slice(0, 10);
  dispatch({ type: 'header', title: `Recent Runs (${Math.min(10, files.length)} of ${files.length})` });
  
  const rows: string[][] = [];
  for (const file of recent) {
    try {
      const manifest = JSON.parse(readFileSync(join(RUNS_DIR, file), 'utf-8')) as ForgeManifest;
      const date = new Date(manifest.timestamp).toLocaleString();
      const taskStr = manifest.task.length > 40 ? manifest.task.slice(0, 40) + '...' : manifest.task;
      const winner = manifest.winner ?? 'none';
      const synthesis = manifest.synthesis?.wins ? 'yes' : '-';
      rows.push([date, taskStr, winner, String(manifest.enginesDispatched), synthesis, manifest.forgeId.slice(0, 8)]);
    } catch (err) {
      console.warn(`[agon] skipping malformed manifest ${file}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  dispatch({ type: 'table', headers: ['Date', 'Task', 'Winner', 'Engines', 'Synth', 'ID'], rows });
  dispatch({ type: 'info', message: 'Use /history <id> for details' });
}

// @kern-source: handlers-info:113
export async function handleEngines(dispatch: Dispatch, ctx: HandlerContext): Promise<void> {
  dispatch({ type: 'header', title: 'Engines' });
  dispatch({ type: 'spinner-start', message: 'Scanning...' });
  
  const config = ctx.config;
  const cesarId = (config as any).cesarEngine ?? config.forgeFixedStarter ?? 'claude';
  const cesarBackend = (config as any).cesarBackend ?? 'auto';
  
  try {
    const engines = ctx.registry.list();
    const results = await Promise.all(
      engines.map(async (engine: any) => {
        const hasBinary = !!(engine.binary && ctx.registry.findBinary(engine));
        const hasApi = !!(engine.api && process.env[engine.api.apiKeyEnv]);
        const avail = hasBinary || hasApi;
        const version = avail ? ((await ctx.adapter.getVersion(engine)) ?? 'unknown') : '';
        return { engine, avail, version, hasBinary, hasApi };
      }),
    );
  
    dispatch({ type: 'spinner-stop' });
  
    const rows = results.map(({ engine, avail, version, hasBinary, hasApi }: any) => {
      // Show which backends are available
      const cli = hasBinary ? '● cli' : '○ cli';
      const api = engine.api ? (hasApi ? '● api' : '○ api') : '— api';
      // Show active backend for Cesar brain engine
      let active = '';
      if (engine.id === cesarId) {
        if (cesarBackend === 'api' && hasApi) active = '← api';
        else if (cesarBackend === 'cli' && hasBinary) active = '← cli';
        else if (cesarBackend === 'auto') active = hasBinary ? '← cli' : hasApi ? '← api' : '';
        active = active ? `[cesar] ${active}` : '[cesar]';
      }
      return [
        engine.id,
        avail ? 'installed' : 'missing',
        cli,
        api,
        version,
        active,
      ];
    });
    dispatch({ type: 'table', headers: ['ID', 'Status', 'CLI', 'API', 'Version', ''], rows });
    dispatch({ type: 'info', message: `Backend: ${cesarBackend}. Switch: /cesar <engine> cli|api` });
  } catch (err) {
    dispatch({ type: 'spinner-stop' });
    throw err;
  }
}

// @kern-source: handlers-info:165
export async function handleDiscover(dispatch: Dispatch, ctx: HandlerContext): Promise<void> {
  dispatch({ type: 'header', title: 'Engine Discovery' });
  dispatch({ type: 'spinner-start', message: 'Scanning installed engines...' });
  
  try {
    const results = await discoverEngines(ctx.registry, ctx.adapter);
    dispatch({ type: 'spinner-stop', message: `${results.length} engines checked` });
  
    const found = results.filter((r: any) => r.found);
    const missing = results.filter((r: any) => !r.found);
  
    if (found.length > 0) {
      const rows = found.map((r: any) => [
        r.id, r.displayName, r.version ?? 'unknown',
        r.envOk ? 'ok' : r.missingEnv.join(', '),
      ]);
      dispatch({ type: 'table', headers: ['Engine', 'Name', 'Version', 'Env'], rows });
    }
    if (missing.length > 0) {
      dispatch({ type: 'info', message: `Not installed: ${missing.map((r: any) => r.id).join(', ')}` });
    }
  } catch (err) {
    dispatch({ type: 'spinner-stop' });
    throw err;
  }
}

// @kern-source: handlers-info:193
export function handleConfig(intent: Intent&{type:'config'}, dispatch: Dispatch): void {
  ensureAgonHome();
  const action = (intent as any).action ?? 'list';
  
  switch (action) {
    case 'list': {
      dispatch({ type: 'header', title: 'Configuration' });
      const config = loadConfig(process.cwd());
      const rows = Object.entries(config).map(([key, value]) => {
        const defaultVal = (DEFAULT_CONFIG as any)[key];
        const isDefault = JSON.stringify(value) === JSON.stringify(defaultVal);
        return [key, String(Array.isArray(value) ? value.join(',') : value), isDefault ? 'default' : 'custom'];
      });
      dispatch({ type: 'table', headers: ['Key', 'Value', 'Source'], rows });
      break;
    }
    case 'get': {
      if (!(intent as any).key) { dispatch({ type: 'error', message: 'Usage: /config get <key>' }); return; }
      const config = loadConfig(process.cwd());
      const key = (intent as any).key as keyof AgonConfig;
      if (key in config) {
        const value = (config as any)[key];
        dispatch({ type: 'text', content: Array.isArray(value) ? value.join(',') : String(value) });
      } else {
        dispatch({ type: 'error', message: `Unknown key: ${(intent as any).key}` });
      }
      break;
    }
    case 'set': {
      if (!(intent as any).key || (intent as any).value === undefined) {
        dispatch({ type: 'error', message: 'Usage: /config set <key> <value>' });
        return;
      }
      const key = (intent as any).key as keyof AgonConfig;
      if (!(key in DEFAULT_CONFIG)) {
        dispatch({ type: 'error', message: `Unknown key: ${(intent as any).key}` });
        return;
      }
      const defaultVal = (DEFAULT_CONFIG as any)[key];
      let parsed: unknown;
      if (typeof defaultVal === 'boolean') parsed = (intent as any).value === 'true';
      else if (typeof defaultVal === 'number') {
        parsed = parseInt((intent as any).value, 10);
        if (isNaN(parsed as number)) { dispatch({ type: 'error', message: `Invalid number: ${(intent as any).value}` }); return; }
      } else if (Array.isArray(defaultVal)) parsed = (intent as any).value.split(',').map((s: string) => s.trim());
      else parsed = (intent as any).value;
      configSet(key, parsed as any);
      dispatch({ type: 'success', message: `Set ${(intent as any).key} = ${(intent as any).value}` });
      break;
    }
    default:
      dispatch({ type: 'error', message: `Unknown config action: ${action}` });
  }
}

// @kern-source: handlers-info:249
export function handleUse(engineIds: string[], dispatch: Dispatch, ctx: HandlerContext, setSessionEngines: (engines:string[]|null)=>void): void {
  if (engineIds.length === 0 || (engineIds.length === 1 && engineIds[0] === 'all')) {
    setSessionEngines(null);
    configSet('forgeEnabledEngines', ctx.registry.availableIds());
    dispatch({ type: 'success', message: 'Using all available engines' });
    dispatch({ type: 'info', message: ctx.registry.availableIds().join(', ') });
    return;
  }
  
  const available = ctx.registry.availableIds();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const id of engineIds) {
    if (available.includes(id)) valid.push(id);
    else invalid.push(id);
  }
  if (invalid.length > 0) dispatch({ type: 'warning', message: `Not available: ${invalid.join(', ')}` });
  if (valid.length === 0) {
    dispatch({ type: 'error', message: `No valid engines selected. Available: ${available.join(', ')}` });
    return;
  }
  setSessionEngines(valid);
  configSet('forgeEnabledEngines', valid);
  
  dispatch({ type: 'success', message: `Active engines: ${valid.join(', ')}` });
  dispatch({ type: 'info', message: 'Saved — persists across sessions. Use /cesar <engine> to change Cesar brain separately.' });
}

// @kern-source: handlers-info:278
export function handleCesar(engineId: string, dispatch: Dispatch, ctx: HandlerContext): void {
  // Parse: "/cesar claude api" or "/cesar claude cli" or "/cesar claude" or "/cesar"
  const parts = engineId.trim().split(/\s+/);
  const id = parts[0] ?? '';
  const backendArg = parts[1]?.toLowerCase();
  
  if (!id) {
    // Show current Cesar brain + backend
    const config = ctx.config;
    const current = (config as any).cesarEngine ?? config.forgeFixedStarter ?? 'claude';
    const backend = (config as any).cesarBackend ?? 'auto';
    dispatch({ type: 'info', message: `Cesar brain: ${current} (backend: ${backend})` });
    dispatch({ type: 'info', message: 'Usage: /cesar <engine> [cli|api|auto]' });
    return;
  }
  
  // Backend-only switch: "/cesar cli" or "/cesar api" or "/cesar auto"
  if (['cli', 'api', 'auto'].includes(id)) {
    configSet('cesarBackend', id);
    // Kill session to force reboot with new backend
    if (ctx.cesarSession) {
      ctx.cesarSession.close();
      ctx.setCesarSession(null);
    }
    dispatch({ type: 'success', message: `Cesar backend set to: ${id}` });
    return;
  }
  
  const available = ctx.registry.availableIds();
  if (!available.includes(id)) {
    dispatch({ type: 'error', message: `Engine "${id}" not available. Available: ${available.join(', ')}` });
    return;
  }
  
  // Validate backend if specified
  if (backendArg && !['cli', 'api', 'auto'].includes(backendArg)) {
    dispatch({ type: 'error', message: `Invalid backend "${backendArg}". Use: cli, api, or auto` });
    return;
  }
  
  if (backendArg === 'api') {
    const engine = ctx.registry.get(id);
    if (!engine.api || !process.env[engine.api.apiKeyEnv]) {
      dispatch({ type: 'error', message: `API not available for ${id} — need ${engine.api?.apiKeyEnv ?? 'API key'}` });
      return;
    }
  }
  if (backendArg === 'cli') {
    const engine = ctx.registry.get(id);
    if (!engine.binary || !ctx.registry.findBinary(engine)) {
      dispatch({ type: 'error', message: `CLI binary not found for ${id}` });
      return;
    }
  }
  
  // Only change Cesar brain — do NOT touch sessionEngines, forgeEnabledEngines, or forgeFixedStarter
  configSet('cesarEngine', id);
  if (backendArg) configSet('cesarBackend', backendArg);
  
  // Kill old persistent session so next message boots fresh with new engine
  if (ctx.cesarSession) {
    ctx.cesarSession.close();
    ctx.setCesarSession(null);
  }
  
  const backend = backendArg ?? (ctx.config as any).cesarBackend ?? 'auto';
  dispatch({ type: 'success', message: `Cesar brain set to: ${id} (backend: ${backend})` });
  dispatch({ type: 'info', message: 'Conversation context + memory preserved. Forge/tribunal engines unchanged — use /use to change those.' });
}

// @kern-source: handlers-info:349
export function handleTokens(dispatch: Dispatch): void {
  const stats = tracker.getStats();
  dispatch({ type: 'header', title: 'Token Usage — This Session' });
  
  if (stats.dispatches === 0) {
    dispatch({ type: 'info', message: 'No engine dispatches yet.' });
    return;
  }
  
  const rows = Object.entries(stats.byEngine).map(([id, e]: [string, any]) => [
    id,
    String(e.dispatches),
    String(e.promptTokens),
    String(e.responseTokens),
    String(e.totalTokens),
    e.costUsd > 0 ? `$${e.costUsd.toFixed(4)}` : 'free',
  ]);
  dispatch({ type: 'table', headers: ['Engine', 'Calls', 'Prompt', 'Response', 'Total', 'Cost'], rows });
  
  const totalCost = stats.totalCostUsd > 0 ? `$${stats.totalCostUsd.toFixed(4)}` : 'free';
  dispatch({ type: 'text', content: `Session total: ${stats.totalTokens} tokens  ${totalCost}` });
  dispatch({ type: 'info', message: `${stats.dispatches} dispatches across ${Object.keys(stats.byEngine).length} engines` });
}

// @kern-source: handlers-info:374
export function handleWorkspace(action: string, dispatch: Dispatch, ctx: HandlerContext, path?: string): void {
  switch (action) {
    case 'add': {
      if (!path) { dispatch({ type: 'error', message: 'Usage: /workspace add <path>' }); return; }
      const ws = addWorkspace(path);
      dispatch({ type: 'success', message: `Added ${ws.name}${ws.isKern ? ' (Kern project)' : ''}` });
      dispatch({ type: 'info', message: ws.path });
      break;
    }
    case 'remove': {
      if (!path) { dispatch({ type: 'error', message: 'Usage: /workspace remove <id>' }); return; }
      if (removeWorkspace(path)) dispatch({ type: 'success', message: `Removed ${path}` });
      else dispatch({ type: 'error', message: `Workspace "${path}" not found` });
      break;
    }
    case 'switch': {
      if (!path) { dispatch({ type: 'error', message: 'Usage: /workspace switch <id>' }); return; }
      const ws = switchWorkspace(path);
      if (ws) {
        dispatch({ type: 'success', message: `Active: ${ws.name} ${ws.path}` });
        // Invalidate Cesar session — it was booted with previous workspace context
        if (ctx.cesarSession) {
          ctx.cesarSession.close();
          ctx.setCesarSession(null);
          dispatch({ type: 'info', message: 'Cesar session reset for new workspace' });
        }
      }
      else dispatch({ type: 'error', message: `Workspace "${path}" not found` });
      break;
    }
    case 'list':
    default: {
      const all = listWorkspaces();
      const active = getActiveWorkspace();
      if (all.length === 0) {
        dispatch({ type: 'info', message: 'No workspaces. Current directory is used by default.' });
        return;
      }
      dispatch({ type: 'header', title: 'Workspaces' });
      const rows = all.map((ws: any) => [
        ws.id === active?.id ? '●' : '○',
        ws.name,
        ws.isKern ? 'kern' : '',
        ws.path,
      ]);
      dispatch({ type: 'table', headers: ['', 'Name', 'Type', 'Path'], rows });
      break;
    }
  }
}

// @kern-source: handlers-info:426
export function handleChats(dispatch: Dispatch, sessionId?: string): void {
  if (sessionId) {
    const session = loadChatSession(sessionId);
    if (!session) {
      dispatch({ type: 'error', message: `Session not found: ${sessionId}` });
      return;
    }
    dispatch({ type: 'header', title: `Chat: ${session.id}` });
    dispatch({ type: 'info', message: `Started: ${session.startedAt}  Messages: ${session.messages.length}` });
    for (const msg of session.messages) {
      if (msg.role === 'user') {
        dispatch({ type: 'text', content: `You: ${msg.content}` });
      } else {
        dispatch({ type: 'engine-block', engineId: (msg as any).engineId ?? 'engine', color: 245, content: msg.content.slice(0, 200) });
      }
    }
    return;
  }
  
  const sessions = listChatSessions(20);
  if (sessions.length === 0) {
    dispatch({ type: 'info', message: 'No chat sessions yet.' });
    return;
  }
  dispatch({ type: 'header', title: 'Chat Sessions' });
  const rows = sessions.map((s: any) => {
    const firstMsg = s.messages.find((m: any) => m.role === 'user');
    const preview = firstMsg ? firstMsg.content.slice(0, 40) : '(empty)';
    return [s.id, String(s.messages.length), s.startedAt.slice(0, 10), preview];
  });
  dispatch({ type: 'table', headers: ['Session', 'Msgs', 'Date', 'First Message'], rows });
}

// @kern-source: handlers-info:460
export function handleModels(dispatch: Dispatch, ctx: HandlerContext): void {
  dispatch({ type: 'header', title: 'Models & Engines' });
  
  const config = ctx.config;
  const available = ctx.registry.availableIds();
  const enabled = config.forgeEnabledEngines ?? available;
  
  const rows = available.map((id: string) => [
    enabled.includes(id) ? '●' : '○',
    id,
    enabled.includes(id) ? 'active' : 'inactive',
  ]);
  dispatch({ type: 'table', headers: ['', 'Engine', 'Status'], rows });
  
  const defaultEngine = config.forgeFixedStarter ?? available[0] ?? 'none';
  dispatch({ type: 'info', message: `Default chat engine: ${defaultEngine}` });
  
  dispatch({ type: 'separator' });
  dispatch({ type: 'info', message: 'Change engines:  /use claude,codex    (persists across sessions)' });
  dispatch({ type: 'info', message: 'Reset to all:    /use all' });
  dispatch({ type: 'info', message: 'Set chat default: /config set forgeFixedStarter claude' });
}

