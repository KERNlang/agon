// @kern-source: tool-orchestration:7
import type { ToolResult, ToolContext, ToolHandler, ToolDefinition, PermissionDecision } from './tool-types.js';

// @kern-source: tool-orchestration:9
export function createForgeTool(): ToolHandler {
  const definition: ToolDefinition = {
    name: 'Forge',
    description: 'Delegate this task to the competitive forge pipeline — multiple AI engines solve the problem independently, then the best solution is selected. Call this instead of solving the task yourself. After calling, STOP and wait.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Brief description of the task to forge' },
        hardened: { type: 'boolean', description: 'Set true for forge-hardened (gauntlet verification). Optional.' },
        team: { type: 'boolean', description: 'Set true for team-forge (teams compete). Optional.' },
      },
      required: ['task'],
    },
    maxResultSizeChars: 500,
    isReadOnly: true,
    isConcurrencySafe: true,
  };
  
  const validate = (input: Record<string, unknown>, _ctx: ToolContext): string | null => {
    if (!input.task || typeof input.task !== 'string' || !(input.task as string).trim()) {
      return 'Missing required parameter: task';
    }
    return null;
  };
  
  const checkPermission = (_input: Record<string, unknown>, _ctx: ToolContext): PermissionDecision => {
    return { behavior: 'allow' };
  };
  
  const execute = async (_input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
    return { ok: true, content: 'Delegation accepted. STOP responding now. The orchestrator will handle the rest.' };
  };
  
  return { definition, validate, checkPermission, execute };
}

// @kern-source: tool-orchestration:47
export function createBrainstormTool(): ToolHandler {
  const definition: ToolDefinition = {
    name: 'Brainstorm',
    description: 'Delegate this question to multi-AI brainstorm — multiple engines provide competing perspectives and confidence bids. Call this instead of answering directly. After calling, STOP and wait.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to brainstorm on' },
        team: { type: 'boolean', description: 'Set true for team-brainstorm. Optional.' },
      },
      required: ['question'],
    },
    maxResultSizeChars: 500,
    isReadOnly: true,
    isConcurrencySafe: true,
  };
  
  const validate = (input: Record<string, unknown>, _ctx: ToolContext): string | null => {
    if (!input.question || typeof input.question !== 'string' || !(input.question as string).trim()) {
      return 'Missing required parameter: question';
    }
    return null;
  };
  
  const checkPermission = (_input: Record<string, unknown>, _ctx: ToolContext): PermissionDecision => {
    return { behavior: 'allow' };
  };
  
  const execute = async (_input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
    return { ok: true, content: 'Delegation accepted. STOP responding now. The orchestrator will handle the rest.' };
  };
  
  return { definition, validate, checkPermission, execute };
}

// @kern-source: tool-orchestration:84
export function createTribunalTool(): ToolHandler {
  const definition: ToolDefinition = {
    name: 'Tribunal',
    description: 'Delegate this question to AI tribunal debate — engines argue different positions. Call this instead of deciding alone. After calling, STOP and wait.',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'The question to debate' },
        mode: { type: 'string', description: 'Debate mode: adversarial, synthesis, steelman, socratic, red-team, or postmortem. Optional.' },
        team: { type: 'boolean', description: 'Set true for team-tribunal. Optional.' },
      },
      required: ['question'],
    },
    maxResultSizeChars: 500,
    isReadOnly: true,
    isConcurrencySafe: true,
  };
  
  const validate = (input: Record<string, unknown>, _ctx: ToolContext): string | null => {
    if (!input.question || typeof input.question !== 'string' || !(input.question as string).trim()) {
      return 'Missing required parameter: question';
    }
    if (input.mode !== undefined) {
      const validModes = ['adversarial', 'synthesis', 'steelman', 'socratic', 'red-team', 'postmortem'];
      if (!validModes.includes(input.mode as string)) {
        return `Invalid mode: ${input.mode}. Must be one of: ${validModes.join(', ')}`;
      }
    }
    return null;
  };
  
  const checkPermission = (_input: Record<string, unknown>, _ctx: ToolContext): PermissionDecision => {
    return { behavior: 'allow' };
  };
  
  const execute = async (_input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
    return { ok: true, content: 'Delegation accepted. STOP responding now. The orchestrator will handle the rest.' };
  };
  
  return { definition, validate, checkPermission, execute };
}

// @kern-source: tool-orchestration:128
export function createCampfireTool(): ToolHandler {
  const definition: ToolDefinition = {
    name: 'Campfire',
    description: 'Open a campfire discussion — all AIs think together on a topic, no competition. Call this for open-ended exploration. After calling, STOP and wait.',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'The topic for open discussion' },
      },
      required: ['topic'],
    },
    maxResultSizeChars: 500,
    isReadOnly: true,
    isConcurrencySafe: true,
  };
  
  const validate = (input: Record<string, unknown>, _ctx: ToolContext): string | null => {
    if (!input.topic || typeof input.topic !== 'string' || !(input.topic as string).trim()) {
      return 'Missing required parameter: topic';
    }
    return null;
  };
  
  const checkPermission = (_input: Record<string, unknown>, _ctx: ToolContext): PermissionDecision => {
    return { behavior: 'allow' };
  };
  
  const execute = async (_input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
    return { ok: true, content: 'Delegation accepted. STOP responding now. The orchestrator will handle the rest.' };
  };
  
  return { definition, validate, checkPermission, execute };
}

// @kern-source: tool-orchestration:164
export function createReportConfidenceTool(): ToolHandler {
  const definition: ToolDefinition = {
    name: 'ReportConfidence',
    description: 'Report your confidence level for this task as a number 0-100. Call this FIRST before responding or calling other tools. Always call this — it replaces writing ~X% in text.',
    inputSchema: {
      type: 'object',
      properties: {
        value: { type: 'number', description: 'Confidence percentage 0-100 (e.g. 92 means 92% confident)' },
        reasoning: { type: 'string', description: 'Brief reason for this confidence level. Optional.' },
      },
      required: ['value'],
    },
    maxResultSizeChars: 200,
    isReadOnly: true,
    isConcurrencySafe: true,
  };
  
  const validate = (input: Record<string, unknown>, _ctx: ToolContext): string | null => {
    if (input.value === undefined || typeof input.value !== 'number') {
      return 'Missing required parameter: value (number 0-100)';
    }
    if ((input.value as number) < 0 || (input.value as number) > 100) {
      return 'value must be between 0 and 100';
    }
    return null;
  };
  
  const checkPermission = (_input: Record<string, unknown>, _ctx: ToolContext): PermissionDecision => {
    return { behavior: 'allow' };
  };
  
  const execute = async (input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
    const v = input.value as number;
    let guidance: string;
    if (v >= 93) guidance = 'High confidence. Proceed — implement directly.';
    else if (v >= 85) guidance = 'Good confidence. Consider delegating to Forge or Brainstorm if the task is complex.';
    else if (v >= 70) guidance = 'Medium confidence. Strongly consider Brainstorm or Tribunal before proceeding.';
    else guidance = 'Low confidence. STOP. Do not implement. Explain what is needed to raise confidence.';
    return { ok: true, content: `Confidence ${v}% recorded. ${guidance}` };
  };
  
  return { definition, validate, checkPermission, execute };
}

// @kern-source: tool-orchestration:210
export function createPipelineTool(): ToolHandler {
  const definition: ToolDefinition = {
    name: 'Pipeline',
    description: 'Delegate to the full pipeline — brainstorm then forge then tribunal. Call this for complex tasks that need the full treatment. After calling, STOP and wait.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task description' },
      },
      required: ['task'],
    },
    maxResultSizeChars: 500,
    isReadOnly: true,
    isConcurrencySafe: true,
  };
  
  const validate = (input: Record<string, unknown>, _ctx: ToolContext): string | null => {
    if (!input.task || typeof input.task !== 'string' || !(input.task as string).trim()) {
      return 'Missing required parameter: task';
    }
    return null;
  };
  
  const checkPermission = (_input: Record<string, unknown>, _ctx: ToolContext): PermissionDecision => {
    return { behavior: 'allow' };
  };
  
  const execute = async (_input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
    return { ok: true, content: 'Delegation accepted. STOP responding now. The orchestrator will handle the rest.' };
  };
  
  return { definition, validate, checkPermission, execute };
}

