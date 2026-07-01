import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { compileWorkflowSpec } from '../../packages/core/src/generated/workflows/compiler.js';
import { createWorkflowRun, verifyWorkflowRunFlow, logFlow, readFlows } from '../../packages/core/src/index.js';
import type { FlowRecord, WorkflowRun } from '../../packages/core/src/index.js';

describe('workflow run isolation', () => {
  it('flags events whose runId does not match the run', () => {
    const plan = compileWorkflowSpec({
      id: 'isolated-run',
      version: '1.0.0',
      phases: [{ id: 'inspect' }],
    });
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-a'),
      status: 'running',
      events: [
        { runId: 'run-a', workflowId: 'isolated-run', phaseId: 'inspect', type: 'started', at: '2026-01-01T00:00:00Z' },
        { runId: 'run-b', workflowId: 'isolated-run', phaseId: 'inspect', type: 'completed', at: '2026-01-01T00:00:01Z' },
      ],
    };

    const issues = verifyWorkflowRunFlow(run);
    const isolationIssue = issues.find((i) => i.path === 'events[1].runId');
    expect(isolationIssue).toBeDefined();
    expect(isolationIssue!.code).toBe('invalid-phase');
    expect(isolationIssue!.message).toContain('run-b');
  });

  it('flags events whose workflowId does not match the run', () => {
    const plan = compileWorkflowSpec({
      id: 'isolated-workflow',
      version: '1.0.0',
      phases: [{ id: 'inspect' }],
    });
    const run: WorkflowRun = {
      ...createWorkflowRun(plan, 'run-a'),
      status: 'running',
      events: [
        { runId: 'run-a', workflowId: 'isolated-workflow', phaseId: 'inspect', type: 'started', at: '2026-01-01T00:00:00Z' },
        { runId: 'run-a', workflowId: 'other-workflow', phaseId: 'inspect', type: 'completed', at: '2026-01-01T00:00:01Z' },
      ],
    };

    const issues = verifyWorkflowRunFlow(run);
    const isolationIssue = issues.find((i) => i.path === 'events[1].workflowId');
    expect(isolationIssue).toBeDefined();
    expect(isolationIssue!.code).toBe('invalid-phase');
    expect(isolationIssue!.message).toContain('other-workflow');
  });
});

describe('flow record compatibility', () => {
  let originalAgonHome: string | undefined;
  let tempHome: string;

  beforeEach(() => {
    originalAgonHome = process.env.AGON_HOME;
    tempHome = mkdtempSync(join(tmpdir(), 'agon-flow-compat-'));
    process.env.AGON_HOME = tempHome;
  });

  afterEach(() => {
    if (originalAgonHome === undefined) {
      delete process.env.AGON_HOME;
    } else {
      process.env.AGON_HOME = originalAgonHome;
    }
    rmSync(tempHome, { recursive: true, force: true });
  });

  it('keeps schemaVersion 1 records without workflowRun readable', () => {
    const oldRecord: FlowRecord = {
      id: 'old-001',
      schemaVersion: 1,
      mode: 'chat',
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:00:01Z',
      completionState: 'completed',
      captureMethod: 'auto',
      telemetry: {
        engines: ['claude'],
        durationMs: 1000,
        tokensByEngine: { claude: { prompt: 10, response: 20 } },
      },
    };

    logFlow(oldRecord);
    const flows = readFlows();
    expect(flows).toHaveLength(1);
    expect(flows[0]).toEqual(oldRecord);
    expect(flows[0].workflowRun).toBeUndefined();
  });

  it('sanitizes flow record ids before writing filenames', () => {
    const record: FlowRecord = {
      id: '../evil',
      schemaVersion: 1,
      mode: 'chat',
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:00:01Z',
      completionState: 'completed',
      captureMethod: 'auto',
      telemetry: {
        engines: ['claude'],
        durationMs: 1000,
        tokensByEngine: { claude: { prompt: 10, response: 20 } },
      },
    };

    const written = logFlow(record);
    expect(written).toContain(join(tempHome, 'flows'));
    expect(written).not.toContain('..');
    expect(readFlows()).toHaveLength(1);
  });

  it('uses record-id hashes to avoid sanitized filename collisions', () => {
    const baseRecord: FlowRecord = {
      id: 'a/b',
      schemaVersion: 1,
      mode: 'chat',
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:00:01Z',
      completionState: 'completed',
      captureMethod: 'auto',
      telemetry: {
        engines: ['claude'],
        durationMs: 1000,
        tokensByEngine: { claude: { prompt: 10, response: 20 } },
      },
    };

    const first = logFlow(baseRecord);
    const second = logFlow({ ...baseRecord, id: 'a_b' });

    expect(first).not.toBe(second);
    expect(readFlows()).toHaveLength(2);
  });

  it('carries optional workflow identity/run metadata on new records', () => {
    const newRecord: FlowRecord = {
      id: 'new-001',
      schemaVersion: 1,
      mode: 'pipeline',
      startedAt: '2026-01-01T00:00:00Z',
      endedAt: '2026-01-01T00:00:01Z',
      completionState: 'completed',
      captureMethod: 'auto',
      telemetry: {
        engines: ['claude'],
        durationMs: 2000,
        tokensByEngine: { claude: { prompt: 100, response: 200 } },
      },
      workflowRun: {
        workflowId: 'release-pipeline',
        runId: 'run-release-42',
        runStatus: 'completed',
      },
    };

    logFlow(newRecord);
    const flows = readFlows();
    expect(flows).toHaveLength(1);
    expect(flows[0].workflowRun).toEqual({
      workflowId: 'release-pipeline',
      runId: 'run-release-42',
      runStatus: 'completed',
    });
  });
});
