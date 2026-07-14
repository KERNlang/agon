import { describe, expect, it } from 'vitest';

import {
  buildMcpJobCommand,
  isJobTool,
  JOB_TOOLS,
} from '../../packages/mcp/src/generated/job-tools.js';
import { listMcpTools } from '../../packages/mcp/src/generated/agon-orchestration.js';

describe('MCP autonomous job tools', () => {
  it('registers the complete non-blocking job control surface', () => {
    expect(JOB_TOOLS.map((tool) => tool.name)).toEqual([
      'JobSubmit', 'JobList', 'JobStatus', 'JobEvents', 'JobResult', 'JobCancel',
    ]);
    expect(listMcpTools().filter((tool) => isJobTool(tool.name)).map((tool) => tool.name))
      .toEqual(JOB_TOOLS.map((tool) => tool.name));
  });

  it('submits only a structured payload through the fixed agon job client', () => {
    expect(buildMcpJobCommand('JobSubmit', {
      kind: 'brainstorm',
      payload: { input: 'design a cache', engines: 'claude,codex' },
    })).toEqual([
      'job', 'submit', 'brainstorm', '--payload',
      JSON.stringify({ input: 'design a cache', engines: 'claude,codex' }), '--json',
    ]);
  });

  it('builds fixed list/status/events/result/cancel requests', () => {
    expect(buildMcpJobCommand('JobList', {})).toEqual(['job', 'list', '--json']);
    expect(buildMcpJobCommand('JobStatus', { jobId: 'job-1' })).toEqual(['job', 'status', 'job-1', '--json']);
    expect(buildMcpJobCommand('JobEvents', { jobId: 'job-1', afterSeq: 4, limit: 20 }))
      .toEqual(['job', 'events', 'job-1', '--after', '4', '--limit', '20', '--json']);
    expect(buildMcpJobCommand('JobResult', { jobId: 'job-1' })).toEqual(['job', 'result', 'job-1', '--json']);
    expect(buildMcpJobCommand('JobCancel', { jobId: 'job-1', reason: 'operator request' }))
      .toEqual(['job', 'cancel', 'job-1', '--reason', 'operator request', '--json']);
  });

  it('rejects malformed ids, payloads, and replay bounds before spawning', () => {
    expect(() => buildMcpJobCommand('JobSubmit', { kind: '', payload: {} })).toThrow(/kind is required/i);
    expect(() => buildMcpJobCommand('JobSubmit', { kind: 'review', payload: [] })).toThrow(/payload must be an object/i);
    expect(() => buildMcpJobCommand('JobStatus', { jobId: '' })).toThrow(/jobId is required/i);
    expect(() => buildMcpJobCommand('JobEvents', { jobId: 'job-1', afterSeq: -1 })).toThrow(/afterSeq/i);
    expect(() => buildMcpJobCommand('JobEvents', { jobId: 'job-1', limit: 0 })).toThrow(/limit/i);
  });
});
