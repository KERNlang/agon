import type {
  PermissionDecision,
  ToolContext,
  ToolDefinition,
  ToolHandler,
  ToolResult,
} from '../models/tool-types.js';

/** Kernel-owned signal tool for the orchestrator's structured confidence gate. */
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
    if (input.value < 0 || input.value > 100) {
      return 'value must be between 0 and 100';
    }
    return null;
  };

  const checkPermission = (_input: Record<string, unknown>, _ctx: ToolContext): PermissionDecision => ({ behavior: 'allow' });

  const execute = async (input: Record<string, unknown>, _ctx: ToolContext): Promise<ToolResult> => {
    const value = input.value as number;
    let guidance: string;
    if (value >= 93) guidance = 'High confidence. Proceed.';
    else if (value >= 85) guidance = 'Good confidence. Investigate if unsure, or pick the right tool: Tribunal for tradeoffs, Forge for competing implementations, Delegate for a second opinion.';
    else if (value >= 70) guidance = 'Medium confidence. Investigate first. Then pick the right mode — Tribunal to stress-test a decision, Brainstorm for creative options, Campfire for fuzzy problems, Forge for code quality.';
    else guidance = 'Low confidence. STOP. Investigate before implementing. Explain what is needed to raise confidence.';
    return { ok: true, content: `Confidence ${value}% recorded. ${guidance}` };
  };

  return { definition, validate, checkPermission, execute };
}
