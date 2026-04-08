// @kern-source: sidechain-logger:1
import { appendFileSync, mkdirSync } from 'node:fs';

// @kern-source: sidechain-logger:2
import { join } from 'node:path';

// @kern-source: sidechain-logger:4
export interface SidechainEvent {
  ts: string;
  type: string;
  sessionType: string;
  sessionId: string;
  engineId?: string;
  parentId?: string;
  data?: Record<string,unknown>;
}

// @kern-source: sidechain-logger:14
export interface SidechainLogger {
  log: (type:string, engineId?:string, data?:Record<string,unknown>)=>void;
  child: (childSessionId:string, childSessionType:string)=>SidechainLogger;
  path: string;
  sessionId: string;
}

// @kern-source: sidechain-logger:20
export function createSidechainLogger(opts: {sessionId:string, sessionType:string, outputDir:string, parentId?:string}): SidechainLogger {
  const suffix = opts.parentId ? `_sidechain_${opts.parentId}` : '';
  const filename = `${opts.sessionType}_${opts.sessionId}${suffix}.jsonl`;
  const logPath = join(opts.outputDir, filename);
  mkdirSync(opts.outputDir, { recursive: true });
  
  function log(type: string, engineId?: string, data?: Record<string, unknown>): void {
    const event: SidechainEvent = {
      ts: new Date().toISOString(),
      type,
      sessionType: opts.sessionType,
      sessionId: opts.sessionId,
      ...(engineId && { engineId }),
      ...(opts.parentId && { parentId: opts.parentId }),
      ...(data && { data }),
    };
    try {
      appendFileSync(logPath, JSON.stringify(event) + '\n');
    } catch (err) {
      console.warn(`[agon] sidechain write failed (${logPath}): ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  
  function child(childSessionId: string, childSessionType: string): SidechainLogger {
    return createSidechainLogger({
      sessionId: childSessionId,
      sessionType: childSessionType,
      outputDir: opts.outputDir,
      parentId: opts.sessionId,
    });
  }
  
  return { log, child, path: logPath, sessionId: opts.sessionId };
}

