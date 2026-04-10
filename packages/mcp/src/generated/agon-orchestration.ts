// @kern-source: agon-orchestration:9
import { writeFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';

// @kern-source: agon-orchestration:10
import { join } from 'node:path';

// @kern-source: agon-orchestration:11
import { createInterface } from 'node:readline';

// @kern-source: agon-orchestration:13
export const ORCHESTRATION_TOOLS: Array<{name:string,description:string,inputSchema:Record<string,unknown>}> = ([
  {
    name: 'Tribunal',
    description: 'Delegate to AI tribunal debate — engines argue positions, produce a verdict. After calling: STOP responding.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to debate' },
        mode: { type: 'string', description: 'Debate mode: adversarial, synthesis, steelman, socratic, red-team, or postmortem', enum: ['adversarial', 'synthesis', 'steelman', 'socratic', 'red-team', 'postmortem'] },
        team: { type: 'boolean', description: 'Solo (false) or team-tribunal (true). Required.' },
      },
      required: ['question', 'team'],
    },
  },
  {
    name: 'Brainstorm',
    description: 'Delegate to multi-AI brainstorm — multiple engines provide competing perspectives. After calling: STOP responding.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to brainstorm on' },
        team: { type: 'boolean', description: 'Solo (false) or team-brainstorm (true). Required.' },
      },
      required: ['question', 'team'],
    },
  },
  {
    name: 'Campfire',
    description: 'Open a campfire discussion — all AIs think together collaboratively. After calling: STOP responding.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The topic for open discussion' },
      },
      required: ['topic'],
    },
  },
  {
    name: 'Forge',
    description: 'Delegate to competitive forge — multiple engines solve independently, best wins. After calling: STOP responding.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task to forge' },
        fitnessCmd: { type: 'string', description: 'Test command for fitness evaluation' },
        hardened: { type: 'boolean', description: 'Set true for gauntlet verification' },
        team: { type: 'boolean', description: 'Solo (false) or team-forge (true). Required — choose based on task scope.' },
      },
      required: ['task', 'team'],
    },
  },
  {
    name: 'Pipeline',
    description: 'Delegate to full pipeline: brainstorm → forge → tribunal. After calling: STOP responding.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task description' },
        fitnessCmd: { type: 'string', description: 'Test command for fitness evaluation' },
      },
      required: ['task'],
    },
  },
  {
    name: 'Review',
    description: 'Delegate to code review. After calling: STOP responding.',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Review target: "uncommitted", "branch:NAME", or "commit:SHA"' },
        engine: { type: 'string', description: 'Specific engine for review' },
      },
    },
  },
  {
    name: 'Delegate',
    description: 'Send a subtask to a specific engine and get the result back. After calling: STOP responding.',
    inputSchema: {
      type: 'object',
      properties: {
        engine: { type: 'string', description: 'Engine ID to delegate to' },
        task: { type: 'string', description: 'The subtask prompt' },
        mode: { type: 'string', description: 'Dispatch mode: exec, review, or agent', enum: ['exec', 'review', 'agent'] },
      },
      required: ['engine', 'task'],
    },
  },
  {
    name: 'ReportConfidence',
    description: 'Report your confidence level (0-100). Call this FIRST on every turn. Does NOT stop your turn — continue after calling.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'number', description: 'Confidence 0-100' },
        reasoning: { type: 'string', description: 'Brief reason for this confidence level' },
      },
      required: ['value'],
    },
  },
]);

// @kern-source: agon-orchestration:117
/**
 * Append a signal to the signal file (array). Supports ReportConfidence + orchestration in same turn.
 */
export function writeSignal(tool: string, args: Record<string,unknown>) {
  const signalDir = process.env.AGON_SIGNAL_DIR;
  const sessionId = process.env.AGON_SESSION_ID;
  if (!signalDir || !sessionId) return;
  try {
    mkdirSync(signalDir, { recursive: true });
    const signalPath = join(signalDir, `${sessionId}.json`);
    let signals: Array<{tool: string; args: Record<string, unknown>; timestamp: number}> = [];
    if (existsSync(signalPath)) {
      try { signals = JSON.parse(readFileSync(signalPath, 'utf-8')); } catch { signals = []; }
    }
    signals.push({ tool, args, timestamp: Date.now() });
    writeFileSync(signalPath, JSON.stringify(signals));
  } catch { /* signal write failed — not critical */ }
}

// @kern-source: agon-orchestration:135
/**
 * Handle an MCP tool call — write signal and return delegation message.
 */
export function handleToolCall(name: string, args: Record<string,unknown>): string {
  const NON_BREAKING = new Set(['ReportConfidence']);
  const BREAK_AND_RESUME = new Set(['Delegate']);
  writeSignal(name, args);
  if (NON_BREAKING.has(name)) {
    return `Confidence ${(args as any).value}% recorded. Continue responding.`;
  }
  if (BREAK_AND_RESUME.has(name)) {
    return `Delegation to ${(args as any).engine} accepted. The orchestrator will execute the subtask and feed the result back to you. STOP responding now — you will receive the result in your next turn.`;
  }
  return 'Delegation accepted. The orchestrator will handle the rest. STOP responding now — do not continue after this tool call.';
}

// @kern-source: agon-orchestration:150
/**
 * Start the Agon orchestration MCP server on stdio. Line-delimited JSONRPC 2.0.
 */
export function startMcpServer() {
  const rl = createInterface({ input: process.stdin, terminal: false });
  
  function respond(id: number | string | null, result: unknown): void {
    if (id === null) return; // notification — no response
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
  }
  
  function respondError(id: number | string | null, code: number, message: string): void {
    if (id === null) return;
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } }) + '\n');
  }
  
  rl.on('line', (line: string) => {
    let msg: any;
    try { msg = JSON.parse(line); } catch { return; }
  
    const { id, method, params } = msg;
  
    if (method === 'initialize') {
      respond(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'agon-orchestration', version: '1.0.0' },
      });
      return;
    }
  
    if (method === 'notifications/initialized' || method === 'initialized') {
      // Client notification — no response needed
      return;
    }
  
    if (method === 'tools/list') {
      respond(id, {
        tools: ORCHESTRATION_TOOLS.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      });
      return;
    }
  
    if (method === 'tools/call') {
      const toolName = params?.name as string;
      const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>;
      const tool = ORCHESTRATION_TOOLS.find(t => t.name === toolName);
      if (!tool) {
        respondError(id, -32602, `Unknown tool: ${toolName}`);
        return;
      }
      const result = handleToolCall(toolName, toolArgs);
      respond(id, {
        content: [{ type: 'text', text: result }],
      });
      return;
    }
  
    // Unknown method — ignore notifications, error on requests
    if (id !== undefined && id !== null) {
      respondError(id, -32601, `Method not found: ${method}`);
    }
  });
  
  rl.on('close', () => process.exit(0));
}

